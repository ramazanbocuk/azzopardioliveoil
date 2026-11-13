import { z } from "zod";
import type { Prisma, ReviewStatus } from "@/generated/prisma/client";
import { audit, toCsv } from "./admin";
import { requireAdmin } from "./auth";
import type { Ctx } from "./context";
import { AppError, parse } from "./errors";

/**
 * Back-office reading and record-keeping: inventory, payments, returns,
 * reviews, reports, VAT, suppliers, lot recall, content, wholesale and
 * marketing. Like admin.ts, every function checks the role first and every
 * change is written to the audit log.
 *
 * Reports are arithmetic over what the shop recorded. They are working
 * figures for the business, not a VAT return or statutory accounts.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

// ───────────────────────────── Period ─────────────────────────────

const DAY = 86_400_000;
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

/** A reporting period in whole UTC days. Defaults to the current month to date; never longer than three years. */
export function period(input: { from?: unknown; to?: unknown }, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let from = isDay(input.from) ? new Date(`${input.from}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let to = isDay(input.to) ? new Date(`${input.to}T00:00:00Z`) : today;
  if (to < from) [from, to] = [to, from];
  if (to.getTime() - from.getTime() > 1096 * DAY) from = new Date(to.getTime() - 1096 * DAY);
  return { from, to, end: new Date(to.getTime() + DAY), fromText: from.toISOString().slice(0, 10), toText: to.toISOString().slice(0, 10) };
}

// ───────────────────────────── Inventory ─────────────────────────────

export async function inventoryOverview(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "inventory");
  const [variants, movements] = await Promise.all([
    ctx.db.variant.findMany({ where: { product: { deletedAt: null } }, orderBy: [{ product: { name: "asc" } }, { position: "asc" }], include: { product: { select: { id: true, name: true } } } }),
    ctx.db.inventoryMovement.findMany({ orderBy: { createdAt: "desc" }, take: 60, include: { variant: { select: { sku: true, label: true, product: { select: { name: true } } } } } }),
  ]);
  const staff = new Map((await ctx.db.adminUser.findMany({ where: { id: { in: movements.map((movement) => movement.adminUserId).filter((id): id is string => !!id) } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
  const rows = variants.map((variant) => {
    const available = variant.stock - variant.reserved;
    return { ...variant, available, low: variant.isActive && available <= variant.lowStockThreshold, valueCents: variant.stock * variant.priceCents };
  });
  const costed = rows.filter((row) => row.costCents !== null);
  return {
    rows,
    unitsOnHand: rows.reduce((sum, row) => sum + row.stock, 0),
    unitsReserved: rows.reduce((sum, row) => sum + row.reserved, 0),
    retailValueCents: rows.reduce((sum, row) => sum + row.valueCents, 0),
    lowCount: rows.filter((row) => row.low).length,
    // Valuation at cost covers only the variants whose unit cost has been entered; the rest are counted, not guessed.
    costValueCents: costed.reduce((sum, row) => sum + row.stock * (row.costCents ?? 0), 0),
    variantsWithoutCost: rows.filter((row) => row.costCents === null && row.stock > 0).length,
    movements: movements.map((movement) => ({ ...movement, by: movement.adminUserId ? (staff.get(movement.adminUserId) ?? "Former staff") : movement.reason === "SALE" ? "Sale" : "System" })),
  };
}

export async function exportInventoryCsv(ctx: Ctx) {
  requireAdmin(ctx, "MANAGER", "inventory");
  const { rows } = await inventoryOverview(ctx);
  await audit(ctx, "inventory.export", "Variant", null, { count: rows.length });
  return toCsv([["Product", "Variant", "SKU", "On hand", "Reserved", "Available", "Low-stock threshold", "Active", "Price"], ...rows.map((row) => [row.product.name, row.label, row.sku, row.stock, row.reserved, row.available, row.lowStockThreshold, row.isActive ? "yes" : "no", row.priceCents / 100])]);
}

// ───────────────────────────── Payments and refunds ─────────────────────────────

const PAYMENT_STATES = ["UNPAID", "PROCESSING", "PAID", "PARTIALLY_REFUNDED", "REFUNDED", "FAILED"] as const;

export async function listPayments(ctx: Ctx, input: { status?: string; from?: string; to?: string; page?: number }) {
  requireAdmin(ctx, "VIEW", "payments");
  const range = period(input);
  const status = PAYMENT_STATES.find((value) => value === input.status);
  const where: Prisma.PaymentWhereInput = { createdAt: { gte: range.from, lt: range.end }, ...(status ? { status } : {}) };
  const page = Math.max(1, Math.round(input.page ?? 1) || 1);
  const [rows, count, received, refunded, disputes] = await Promise.all([
    ctx.db.payment.findMany({ where, orderBy: { createdAt: "desc" }, take: 30, skip: (page - 1) * 30, include: { refunds: { where: { failedAt: null } }, order: { select: { id: true, number: true, email: true } } } }),
    ctx.db.payment.count({ where }),
    ctx.db.payment.aggregate({ where: { createdAt: { gte: range.from, lt: range.end }, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } }, _sum: { amountCents: true }, _count: true }),
    ctx.db.refund.aggregate({ where: { failedAt: null, createdAt: { gte: range.from, lt: range.end } }, _sum: { amountCents: true }, _count: true }),
    ctx.db.dispute.findMany({ where: { OR: [{ closedAt: null }, { createdAt: { gte: range.from, lt: range.end } }] }, orderBy: { createdAt: "desc" }, take: 50, include: { payment: { select: { order: { select: { id: true, number: true, email: true } } } } } }),
  ]);
  const lost = disputes.filter((dispute) => dispute.status === "lost" && dispute.closedAt && dispute.closedAt >= range.from && dispute.closedAt < range.end);
  return { disputes, lostCents: lost.reduce((sum, dispute) => sum + dispute.amountCents, 0), lostCount: lost.length, rows, count, page, pages: Math.max(1, Math.ceil(count / 30)), range, receivedCents: received._sum.amountCents ?? 0, receivedCount: received._count, refundedCents: refunded._sum.amountCents ?? 0, refundedCount: refunded._count };
}

export async function listReturnsAndRefunds(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "returns");
  const [returns, refunds] = await Promise.all([
    ctx.db.returnRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { order: { select: { id: true, number: true, email: true, shipFirstName: true, shipLastName: true, items: true } } } }),
    ctx.db.refund.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { payment: { select: { provider: true, order: { select: { id: true, number: true } } } } } }),
  ]);
  const staff = new Map((await ctx.db.adminUser.findMany({ where: { id: { in: refunds.map((refund) => refund.adminUserId).filter((id): id is string => !!id) } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
  return {
    returns: returns.map((request) => {
      const lines = Array.isArray(request.items) ? (request.items as { orderItemId?: string; quantity?: number }[]) : [];
      return { ...request, lines: lines.map((line) => ({ quantity: line.quantity ?? 0, name: (() => { const item = request.order.items.find((candidate) => candidate.id === line.orderItemId); return item ? `${item.productName} ${item.variantLabel}` : "Removed line"; })() })) };
    }),
    open: returns.filter((request) => request.status === "REQUESTED" || request.status === "APPROVED").length,
    refunds: refunds.map((refund) => ({ ...refund, by: refund.adminUserId ? (staff.get(refund.adminUserId) ?? "Former staff") : "At the payment provider" })),
  };
}

// ───────────────────────────── Reviews ─────────────────────────────

const REVIEW_STATES = ["PENDING", "APPROVED", "REJECTED"] as const satisfies readonly ReviewStatus[];

export async function listReviews(ctx: Ctx, status?: string) {
  requireAdmin(ctx, "VIEW", "reviews");
  const filter = REVIEW_STATES.find((value) => value === status);
  const [rows, counts] = await Promise.all([
    ctx.db.review.findMany({ where: filter ? { status: filter } : {}, orderBy: { createdAt: "desc" }, take: 100, include: { product: { select: { name: true, slug: true } }, customer: { select: { firstName: true, lastName: true, email: true } } } }),
    ctx.db.review.groupBy({ by: ["status"], _count: true }),
  ]);
  return { rows, counts: Object.fromEntries(REVIEW_STATES.map((state) => [state, counts.find((row) => row.status === state)?._count ?? 0])) as Record<ReviewStatus, number> };
}

/** Only approved reviews are shown on the storefront. A customer's words are never edited: approve or reject. */
export async function setReviewStatus(ctx: Ctx, id: string, status: string) {
  requireAdmin(ctx, "MANAGER", "reviews");
  const next = REVIEW_STATES.find((value) => value === status);
  if (!next) throw new AppError("BAD_INPUT", "Choose approve or reject.");
  const review = await ctx.db.review.update({ where: { id }, data: { status: next } }).catch(() => null);
  if (!review) throw new AppError("NOT_FOUND", "Review not found.");
  await audit(ctx, "review.status", "Review", id, { status: next });
}

// ───────────────────────────── Sales report ─────────────────────────────

type Money = bigint | number | null;
const num = (value: Money) => Number(value ?? 0);

/** Sales by payment date. "Gross" is what customers paid, VAT included; refunds are shown separately, by refund date. */
export async function salesReport(ctx: Ctx, input: { from?: string; to?: string }) {
  requireAdmin(ctx, "MANAGER", "reports");
  const range = period(input);
  const { from, end } = range;
  const [totals, daily, countries, products, methods, refunds, customers] = await Promise.all([
    ctx.db.$queryRaw<{ orders: bigint; gross: Money; tax: Money; shipping: Money; discount: Money; untaxed: bigint }[]>`
      SELECT COUNT(*)::bigint AS orders, SUM("totalCents")::bigint AS gross, SUM(COALESCE("taxCents", 0))::bigint AS tax, SUM("shippingCents")::bigint AS shipping, SUM("discountCents")::bigint AS discount,
             COUNT(*) FILTER (WHERE "taxCents" IS NULL)::bigint AS untaxed
      FROM "Order" WHERE "paidAt" >= ${from} AND "paidAt" < ${end}`,
    ctx.db.$queryRaw<{ day: Date; orders: bigint; gross: Money }[]>`
      SELECT date_trunc('day', "paidAt") AS day, COUNT(*)::bigint AS orders, SUM("totalCents")::bigint AS gross
      FROM "Order" WHERE "paidAt" >= ${from} AND "paidAt" < ${end} GROUP BY 1 ORDER BY 1`,
    ctx.db.$queryRaw<{ country: string; orders: bigint; gross: Money }[]>`
      SELECT "shipCountryCode" AS country, COUNT(*)::bigint AS orders, SUM("totalCents")::bigint AS gross
      FROM "Order" WHERE "paidAt" >= ${from} AND "paidAt" < ${end} GROUP BY 1 ORDER BY 3 DESC`,
    ctx.db.$queryRaw<{ sku: string; name: string; units: bigint; gross: Money }[]>`
      SELECT i."sku", i."productName" || ' ' || i."variantLabel" AS name, SUM(i."quantity")::bigint AS units, SUM(i."lineTotalCents")::bigint AS gross
      FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId" WHERE o."paidAt" >= ${from} AND o."paidAt" < ${end} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25`,
    ctx.db.$queryRaw<{ method: string | null; payments: bigint; amount: Money }[]>`
      SELECT p."method", COUNT(*)::bigint AS payments, SUM(p."amountCents")::bigint AS amount
      FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId"
      WHERE o."paidAt" >= ${from} AND o."paidAt" < ${end} AND p."status" IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') GROUP BY 1 ORDER BY 3 DESC`,
    ctx.db.refund.aggregate({ where: { failedAt: null, createdAt: { gte: from, lt: end } }, _sum: { amountCents: true }, _count: true }),
    ctx.db.$queryRaw<{ returning: bigint; first: bigint }[]>`
      SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Order" p WHERE p."email" = o."email" AND p."paidAt" < o."paidAt"))::bigint AS returning,
             COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "Order" p WHERE p."email" = o."email" AND p."paidAt" < o."paidAt"))::bigint AS first
      FROM "Order" o WHERE o."paidAt" >= ${from} AND o."paidAt" < ${end}`,
  ]);
  const total = totals[0];
  const orders = num(total?.orders);
  const gross = num(total?.gross);
  const units = products.reduce((sum, row) => sum + num(row.units), 0);
  return {
    range,
    orders,
    grossCents: gross,
    taxCents: num(total?.tax),
    netCents: gross - num(total?.tax),
    shippingCents: num(total?.shipping),
    discountCents: num(total?.discount),
    ordersWithoutVat: num(total?.untaxed),
    refundedCents: refunds._sum.amountCents ?? 0,
    refundCount: refunds._count,
    averageOrderCents: orders ? Math.round(gross / orders) : 0,
    units,
    firstTimeOrders: num(customers[0]?.first),
    returningOrders: num(customers[0]?.returning),
    daily: daily.map((row) => ({ day: row.day.toISOString().slice(0, 10), orders: num(row.orders), grossCents: num(row.gross) })),
    countries: countries.map((row) => ({ country: row.country, orders: num(row.orders), grossCents: num(row.gross) })),
    products: products.map((row) => ({ sku: row.sku, name: row.name, units: num(row.units), grossCents: num(row.gross) })),
    methods: methods.map((row) => ({ method: row.method ?? "unknown", payments: num(row.payments), amountCents: num(row.amount) })),
  };
}

export async function exportSalesCsv(ctx: Ctx, input: { from?: string; to?: string }) {
  const report = await salesReport(ctx, input);
  await audit(ctx, "report.sales.export", "Order", null, { from: report.range.fromText, to: report.range.toText });
  return toCsv([["Day", "Orders", "Gross (incl. VAT)"], ...report.daily.map((row) => [row.day, row.orders, row.grossCents / 100]), [], ["Product", "SKU", "Units", "Gross"], ...report.products.map((row) => [row.name, row.sku, row.units, row.grossCents / 100])]);
}

// ───────────────────────────── VAT report ─────────────────────────────

/**
 * VAT collected, by destination country and rate, for orders paid in the
 * period. Shipping VAT is included in each row. Refunds are listed apart,
 * because how a refund adjusts VAT depends on the credit note, which this
 * shop does not issue yet.
 */
export async function vatReport(ctx: Ctx, input: { from?: string; to?: string }) {
  requireAdmin(ctx, "MANAGER", "accounting");
  const range = period(input);
  const [rows, refunds] = await Promise.all([
    ctx.db.$queryRaw<{ country: string; rate: number | null; orders: bigint; gross: Money; tax: Money; shipping_tax: Money }[]>`
      SELECT "shipCountryCode" AS country, "taxRateBps" AS rate, COUNT(*)::bigint AS orders, SUM("totalCents")::bigint AS gross, SUM(COALESCE("taxCents", 0))::bigint AS tax, SUM(COALESCE("shippingTaxCents", 0))::bigint AS shipping_tax
      FROM "Order" WHERE "paidAt" >= ${range.from} AND "paidAt" < ${range.end} GROUP BY 1, 2 ORDER BY 1, 2`,
    ctx.db.refund.findMany({ where: { failedAt: null, createdAt: { gte: range.from, lt: range.end } }, orderBy: { createdAt: "asc" }, include: { payment: { select: { order: { select: { id: true, number: true, shipCountryCode: true, taxRateBps: true } } } } } }),
  ]);
  const lines = rows.map((row) => ({ country: row.country, rateBps: row.rate, orders: num(row.orders), grossCents: num(row.gross), taxCents: num(row.tax), netCents: num(row.gross) - num(row.tax), shippingTaxCents: num(row.shipping_tax) }));
  return {
    range,
    lines,
    grossCents: lines.reduce((sum, line) => sum + line.grossCents, 0),
    taxCents: lines.reduce((sum, line) => sum + line.taxCents, 0),
    netCents: lines.reduce((sum, line) => sum + line.netCents, 0),
    ordersWithoutRate: lines.filter((line) => line.rateBps === null).reduce((sum, line) => sum + line.orders, 0),
    refunds: refunds.map((refund) => ({ id: refund.id, at: refund.createdAt, amountCents: refund.amountCents, orderId: refund.payment.order.id, number: refund.payment.order.number, country: refund.payment.order.shipCountryCode, rateBps: refund.payment.order.taxRateBps })),
    refundedCents: refunds.reduce((sum, refund) => sum + refund.amountCents, 0),
  };
}

export async function exportVatCsv(ctx: Ctx, input: { from?: string; to?: string }) {
  const report = await vatReport(ctx, input);
  await audit(ctx, "report.vat.export", "Order", null, { from: report.range.fromText, to: report.range.toText });
  return toCsv([
    ["Period", report.range.fromText, report.range.toText],
    [],
    ["Country", "VAT rate %", "Orders", "Net", "VAT", "Gross", "Of which VAT on shipping"],
    ...report.lines.map((line) => [line.country, line.rateBps === null ? "no rate set" : line.rateBps / 100, line.orders, line.netCents / 100, line.taxCents / 100, line.grossCents / 100, line.shippingTaxCents / 100]),
    [],
    ["Refunds in period (not netted above)"],
    ["Date", "Order", "Country", "VAT rate %", "Amount"],
    ...report.refunds.map((refund) => [refund.at.toISOString().slice(0, 10), refund.number, refund.country, refund.rateBps === null ? null : refund.rateBps / 100, refund.amountCents / 100]),
  ]);
}

// ───────────────────────────── Suppliers ─────────────────────────────

export const SUPPLIER_KINDS = ["Grower", "Mill", "Bottler", "Packaging", "Logistics", "Other"] as const;

const supplierInput = z.object({
  name: z.string().trim().min(1, "Enter the supplier's name.").max(160),
  kind: z.enum(SUPPLIER_KINDS).default("Other"),
  contactName: optionalText(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254).nullish().or(z.literal("")).transform((value) => value || null),
  phone: optionalText(40),
  address: optionalText(400),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Enter the country as a two-letter code, such as IT.").nullish().or(z.literal("")).transform((value) => value || null),
  vatNumber: optionalText(40),
  notes: optionalText(2000),
  isActive: z.boolean().default(true),
});

export async function listSuppliers(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "suppliers");
  return ctx.db.supplier.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { _count: { select: { batches: true } }, batches: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, lotNumber: true } } } });
}

export async function saveSupplier(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER", "suppliers");
  const data = parse(supplierInput, input);
  const supplier = id ? await ctx.db.supplier.update({ where: { id }, data }) : await ctx.db.supplier.create({ data });
  await audit(ctx, id ? "supplier.update" : "supplier.create", "Supplier", supplier.id, { name: supplier.name });
  return supplier.id;
}

/** A supplier with lots on record is kept (deactivated) so traceability is never broken; one without is removed. */
export async function removeSupplier(ctx: Ctx, id: string) {
  requireAdmin(ctx, "MANAGER", "suppliers");
  const lots = await ctx.db.batch.count({ where: { supplierId: id } });
  if (lots > 0) await ctx.db.supplier.update({ where: { id }, data: { isActive: false } });
  else await ctx.db.supplier.delete({ where: { id } });
  await audit(ctx, lots > 0 ? "supplier.deactivate" : "supplier.delete", "Supplier", id);
  return lots > 0 ? "deactivated" : "deleted";
}

// ───────────────────────────── Lot traceability ─────────────────────────────

/**
 * Forward trace for one lot: every order line packed from it, and who
 * received it. This is the list needed for a withdrawal or recall. It can
 * only be as complete as the lot numbers staff recorded on order lines.
 */
export async function traceLot(ctx: Ctx, rawLot: string) {
  requireAdmin(ctx, "VIEW", "traceability");
  const lotNumber = rawLot.trim().toUpperCase();
  if (!lotNumber) return null;
  const [batch, lines, unrecorded] = await Promise.all([
    ctx.db.batch.findUnique({ where: { lotNumber }, include: { product: { select: { id: true, name: true } }, supplier: true, documents: true } }),
    ctx.db.orderItem.findMany({ where: { lotNumber }, orderBy: { order: { placedAt: "asc" } }, include: { order: { select: { id: true, number: true, email: true, shipFirstName: true, shipLastName: true, shipCity: true, shipCountryCode: true, shipPhone: true, status: true, paidAt: true, shipments: { where: { cancelledAt: null }, select: { carrier: true, trackingNumber: true, shippedAt: true } } } } } }),
    ctx.db.orderItem.count({ where: { lotNumber: null, shippedQuantity: { gt: 0 } } }),
  ]);
  return { lotNumber, batch, lines, units: lines.reduce((sum, line) => sum + line.quantity, 0), orders: new Set(lines.map((line) => line.orderId)).size, shippedLinesWithoutLot: unrecorded };
}

export async function exportLotTraceCsv(ctx: Ctx, rawLot: string) {
  requireAdmin(ctx, "MANAGER", "traceability");
  const trace = await traceLot(ctx, rawLot);
  if (!trace) throw new AppError("BAD_INPUT", "Enter a lot number.");
  await audit(ctx, "lot.trace.export", "Batch", trace.batch?.id ?? null, { lotNumber: trace.lotNumber, orders: trace.orders });
  return toCsv([
    ["Lot", trace.lotNumber, trace.batch ? trace.batch.product.name : "not on record"],
    [],
    ["Order", "Paid", "Status", "Customer", "Email", "Phone", "City", "Country", "Product", "SKU", "Units", "Carrier", "Tracking"],
    ...trace.lines.map((line) => [line.order.number, line.order.paidAt?.toISOString().slice(0, 10) ?? null, line.order.status, `${line.order.shipFirstName} ${line.order.shipLastName}`, line.order.email, line.order.shipPhone, line.order.shipCity, line.order.shipCountryCode, `${line.productName} ${line.variantLabel}`, line.sku, line.quantity, line.order.shipments.map((shipment) => shipment.carrier).join("; ") || null, line.order.shipments.map((shipment) => shipment.trackingNumber).filter(Boolean).join("; ") || null]),
  ]);
}

// ───────────────────────────── Website content ─────────────────────────────

const postInput = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.").max(120),
  kind: z.enum(["Story", "Recipe", "Guide", "News"]).default("Story"),
  title: z.string().trim().min(1, "Enter a title.").max(160),
  standfirst: z.string().trim().max(400).default(""),
  body: z.string().trim().max(40_000).default(""),
  isPublished: z.boolean().default(false),
});

export async function listPosts(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "content");
  return ctx.db.journalPost.findMany({ orderBy: [{ isPublished: "desc" }, { updatedAt: "desc" }] });
}

export async function getPost(ctx: Ctx, id: string) {
  requireAdmin(ctx, "VIEW", "content");
  const post = await ctx.db.journalPost.findUnique({ where: { id } });
  if (!post) throw new AppError("NOT_FOUND", "Article not found.");
  return post;
}

export async function savePost(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER", "content");
  const data = parse(postInput, input);
  const clash = await ctx.db.journalPost.findUnique({ where: { slug: data.slug } });
  if (clash && clash.id !== id) throw new AppError("BAD_INPUT", "Another article already uses that address.", "slug");
  const existing = id ? await ctx.db.journalPost.findUnique({ where: { id } }) : null;
  const publishedAt = data.isPublished ? (existing?.publishedAt ?? new Date()) : null;
  const post = id ? await ctx.db.journalPost.update({ where: { id }, data: { ...data, publishedAt } }) : await ctx.db.journalPost.create({ data: { ...data, publishedAt } });
  await audit(ctx, id ? "content.post.update" : "content.post.create", "JournalPost", post.id, { slug: post.slug, isPublished: post.isPublished });
  return post.id;
}

export async function deletePost(ctx: Ctx, id: string) {
  requireAdmin(ctx, "MANAGER", "content");
  await ctx.db.journalPost.delete({ where: { id } });
  await audit(ctx, "content.post.delete", "JournalPost", id);
}

// ───────────────────────────── Wholesale ─────────────────────────────

const wholesaleInput = z.object({
  wholesaleStatus: z.enum(["NONE", "REQUESTED", "APPROVED", "REJECTED"]),
  companyName: optionalText(160),
  companyVatNumber: optionalText(40),
  /** Typed as a percentage, e.g. "15" or "12.5". */
  discountPercent: z.coerce.number().min(0, "Enter a discount between 0 and 60%.").max(60, "Enter a discount between 0 and 60%.").default(0),
  wholesaleNote: optionalText(1000),
});

export async function listWholesale(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "wholesale");
  const accounts = await ctx.db.customer.findMany({ where: { erasedAt: null, wholesaleStatus: { not: "NONE" } }, orderBy: [{ wholesaleStatus: "asc" }, { companyName: "asc" }], include: { orders: { where: { paidAt: { not: null } }, select: { totalCents: true } } } });
  return accounts.map((account) => ({ ...account, paidOrders: account.orders.length, spentCents: account.orders.reduce((sum, order) => sum + order.totalCents, 0) }));
}

/** Sets a customer's trade terms. An approved account gets its discount on goods automatically at checkout. */
export async function setWholesale(ctx: Ctx, customerId: string, input: unknown) {
  requireAdmin(ctx, "MANAGER", "wholesale");
  const data = parse(wholesaleInput, input);
  if (data.wholesaleStatus === "APPROVED" && !data.companyName) throw new AppError("BAD_INPUT", "Enter the company name before approving a wholesale account.", "companyName");
  const customer = await ctx.db.customer.findFirst({ where: { id: customerId, erasedAt: null } });
  if (!customer) throw new AppError("NOT_FOUND", "Customer not found.");
  const wholesaleDiscountBps = data.wholesaleStatus === "APPROVED" ? Math.round(data.discountPercent * 100) : 0;
  await ctx.db.customer.update({ where: { id: customerId }, data: { wholesaleStatus: data.wholesaleStatus, companyName: data.companyName, companyVatNumber: data.companyVatNumber, wholesaleDiscountBps, wholesaleNote: data.wholesaleNote } });
  if (data.wholesaleStatus === "APPROVED" && customer.wholesaleStatus !== "APPROVED") {
    await ctx.db.outboxJob.createMany({ data: [{ kind: "notify.customer.wholesale_approved", dedupeKey: `notify.customer.wholesale_approved:${customerId}:${Date.now()}`, payload: { customerId } }], skipDuplicates: true });
  }
  await audit(ctx, "customer.wholesale", "Customer", customerId, { status: data.wholesaleStatus, discountBps: wholesaleDiscountBps });
}

/** Opens trade terms for an existing customer account, found by its email address. */
export async function setWholesaleByEmail(ctx: Ctx, email: string, input: unknown) {
  requireAdmin(ctx, "MANAGER", "wholesale");
  const customer = await ctx.db.customer.findFirst({ where: { email: email.trim().toLowerCase(), erasedAt: null }, select: { id: true } });
  if (!customer) throw new AppError("BAD_INPUT", "No customer account uses that email address. The customer must create an account on the shop first.", "email");
  await setWholesale(ctx, customer.id, input);
}

// ───────────────────────────── Marketing ─────────────────────────────

export async function marketingOverview(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "marketing");
  const dayAgo = new Date(Date.now() - DAY);
  const [subscribers, discounts, usage, carts] = await Promise.all([
    ctx.db.newsletterSubscriber.groupBy({ by: ["status"], _count: true }),
    ctx.db.discount.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    ctx.db.order.groupBy({ by: ["discountCode"], where: { discountCode: { not: null }, paidAt: { not: null } }, _count: true, _sum: { totalCents: true, discountCents: true } }),
    ctx.db.cart.findMany({ where: { items: { some: {} }, updatedAt: { lt: dayAgo } }, orderBy: { updatedAt: "desc" }, take: 50, include: { customer: { select: { email: true, firstName: true, marketingOptIn: true } }, items: { include: { variant: { select: { priceCents: true, label: true, product: { select: { name: true } } } } } } } }),
  ]);
  const count = (status: string) => subscribers.find((row) => row.status === status)?._count ?? 0;
  return {
    subscribed: count("SUBSCRIBED"),
    pending: count("PENDING"),
    unsubscribed: count("UNSUBSCRIBED"),
    discounts: discounts.map((discount) => {
      const used = usage.find((row) => row.discountCode === discount.code);
      return { ...discount, paidOrders: used?._count ?? 0, revenueCents: used?._sum.totalCents ?? 0, givenCents: used?._sum.discountCents ?? 0 };
    }),
    wholesaleOrders: usage.find((row) => row.discountCode === "WHOLESALE")?._count ?? 0,
    abandoned: carts.map((cart) => ({ id: cart.id, updatedAt: cart.updatedAt, email: cart.customer?.email ?? null, mayEmail: cart.customer?.marketingOptIn ?? false, units: cart.items.reduce((sum, item) => sum + item.quantity, 0), valueCents: cart.items.reduce((sum, item) => sum + item.quantity * item.variant.priceCents, 0), summary: cart.items.map((item) => `${item.quantity} × ${item.variant.product.name} ${item.variant.label}`).join(", ") })),
  };
}

// ───────────────────────────── Product photos ─────────────────────────────

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const PHOTOS_PER_PRODUCT = 12;

/** The real type of an image, read from its first bytes. The browser's claim is not trusted. */
export function sniffImage(data: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => data[index] === byte)) return "image/png";
  if (data.length >= 12 && String.fromCharCode(...data.slice(0, 4)) === "RIFF" && String.fromCharCode(...data.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function listProductPhotos(ctx: Ctx, productId: string) {
  requireAdmin(ctx, "VIEW", "catalog");
  return ctx.db.productImage.findMany({ where: { productId }, orderBy: { position: "asc" }, select: { id: true, url: true, alt: true, position: true, mime: true, bytes: true } });
}

/** Stores a photo in the database. JPEG, PNG or WebP up to 4 MB; anything else is refused, whatever its file name says. */
export async function addProductPhoto(ctx: Ctx, productId: string, file: { data: Uint8Array; alt: string }) {
  requireAdmin(ctx, "MANAGER", "catalog");
  if (file.data.length === 0) throw new AppError("BAD_INPUT", "Choose a photo to upload.");
  if (file.data.length > PHOTO_MAX_BYTES) throw new AppError("BAD_INPUT", "That photo is larger than 4 MB. Export it smaller and try again.");
  const mime = sniffImage(file.data);
  if (!mime) throw new AppError("BAD_INPUT", "Upload a JPEG, PNG or WebP image.");
  const alt = file.alt.trim().slice(0, 200);
  if (!alt) throw new AppError("BAD_INPUT", "Describe the photo in a few words, for people who cannot see it.", "alt");
  const product = await ctx.db.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, _count: { select: { images: true } } } });
  if (!product) throw new AppError("NOT_FOUND", "Product not found.");
  if (product._count.images >= PHOTOS_PER_PRODUCT) throw new AppError("BAD_INPUT", `A product can have up to ${PHOTOS_PER_PRODUCT} photos. Delete one first.`);
  const created = await ctx.db.productImage.create({ data: { productId, url: "", alt, position: product._count.images, data: new Uint8Array(file.data), mime, bytes: file.data.length } });
  await ctx.db.productImage.update({ where: { id: created.id }, data: { url: `/media/${created.id}` } });
  await audit(ctx, "product.photo.add", "Product", productId, { imageId: created.id, bytes: file.data.length, mime });
  return created.id;
}

export async function removeProductPhoto(ctx: Ctx, imageId: string) {
  requireAdmin(ctx, "MANAGER", "catalog");
  const image = await ctx.db.productImage.delete({ where: { id: imageId }, select: { productId: true } }).catch(() => null);
  if (!image) throw new AppError("NOT_FOUND", "Photo not found.");
  await audit(ctx, "product.photo.remove", "Product", image.productId, { imageId });
  return image.productId;
}

// ───────────────────────────── Purchase orders ─────────────────────────────

const purchaseInput = z.object({
  supplierId: z.string().min(1, "Choose a supplier."),
  expectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((value) => (value ? new Date(`${value}T00:00:00Z`) : null)),
  notes: optionalText(1000),
  lines: z.array(z.object({ sku: z.string().trim().min(1), quantity: z.coerce.number().int().min(1).max(100_000), unitCostCents: z.coerce.number().int().min(0).max(10_000_000) })).min(1, "Add at least one line with a quantity."),
});

export const purchaseNumber = (sequence: number) => `PO-${String(sequence).padStart(4, "0")}`;

export async function listPurchaseOrders(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "inventory");
  const orders = await ctx.db.purchaseOrder.findMany({ orderBy: { createdAt: "desc" }, take: 60, include: { supplier: { select: { name: true } }, lines: { include: { variant: { select: { sku: true, label: true, product: { select: { name: true } } } } } } } });
  return orders.map((order) => ({ ...order, number: purchaseNumber(order.sequence), units: order.lines.reduce((sum, line) => sum + line.quantity, 0), costCents: order.lines.reduce((sum, line) => sum + line.quantity * line.unitCostCents, 0) }));
}

export async function createPurchaseOrder(ctx: Ctx, input: unknown) {
  const admin = requireAdmin(ctx, "MANAGER", "inventory");
  const data = parse(purchaseInput, input);
  const supplier = await ctx.db.supplier.findFirst({ where: { id: data.supplierId, isActive: true } });
  if (!supplier) throw new AppError("BAD_INPUT", "Choose an active supplier.", "supplierId");
  const variants = await ctx.db.variant.findMany({ where: { sku: { in: data.lines.map((line) => line.sku) } }, select: { id: true, sku: true } });
  const lines = data.lines.map((line) => {
    const variant = variants.find((candidate) => candidate.sku === line.sku);
    if (!variant) throw new AppError("BAD_INPUT", `There is no product with SKU ${line.sku}.`);
    return { variantId: variant.id, quantity: line.quantity, unitCostCents: line.unitCostCents };
  });
  const order = await ctx.db.purchaseOrder.create({ data: { supplierId: supplier.id, expectedAt: data.expectedAt, notes: data.notes, adminUserId: admin.id, lines: { create: lines } } });
  await audit(ctx, "purchase.create", "PurchaseOrder", order.id, { number: purchaseNumber(order.sequence), supplier: supplier.name, lines: lines.length });
  return order.id;
}

/** Marks a draft as sent to the supplier, or cancels an order that has not arrived. Stock does not change. */
export async function setPurchaseOrderStatus(ctx: Ctx, id: string, status: "ORDERED" | "CANCELLED") {
  requireAdmin(ctx, "MANAGER", "inventory");
  const from = status === "ORDERED" ? ["DRAFT"] : ["DRAFT", "ORDERED"];
  const changed = await ctx.db.purchaseOrder.updateMany({ where: { id, status: { in: from } }, data: { status, ...(status === "ORDERED" ? { orderedAt: new Date() } : {}) } });
  if (changed.count !== 1) throw new AppError("BAD_INPUT", status === "ORDERED" ? "Only a draft can be marked as ordered." : "A received or cancelled purchase order cannot be cancelled.");
  await audit(ctx, `purchase.${status.toLowerCase()}`, "PurchaseOrder", id);
}

/**
 * Books the delivery into stock, once: every line is added to stock with a
 * ledger entry naming the purchase order, and its unit cost becomes the
 * product's recorded cost. Receiving the same order twice is refused.
 */
export async function receivePurchaseOrder(ctx: Ctx, id: string) {
  const admin = requireAdmin(ctx, "MANAGER", "inventory");
  await ctx.db.$transaction(async (tx) => {
    const claimed = await tx.purchaseOrder.updateMany({ where: { id, status: { in: ["DRAFT", "ORDERED"] } }, data: { status: "RECEIVED", receivedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError("BAD_INPUT", "This purchase order has already been received or was cancelled.");
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    for (const line of order.lines) {
      await tx.variant.update({ where: { id: line.variantId }, data: { stock: { increment: line.quantity }, costCents: line.unitCostCents } });
      await tx.inventoryMovement.create({ data: { variantId: line.variantId, delta: line.quantity, reason: "RECEIVED", adminUserId: admin.id, note: purchaseNumber(order.sequence) } });
    }
  });
  await audit(ctx, "purchase.received", "PurchaseOrder", id);
}

// ───────────────────────────── Customer relationship ─────────────────────────────

export const SEGMENTS = { all: "Everyone", repeat: "Repeat customers (2+ paid orders)", vip: "Tagged VIP", wholesale: "Wholesale accounts", consent: "Agreed to marketing", none: "Account, no paid order" } as const;
export type Segment = keyof typeof SEGMENTS;

/** Customer accounts with what each has spent. Guests who never made an account are not listed here: they appear on their orders. */
export async function customerDirectory(ctx: Ctx, input: { q?: string; segment?: string; tag?: string }) {
  requireAdmin(ctx, "VIEW", "customers");
  const term = input.q?.trim();
  const segment = (Object.keys(SEGMENTS) as Segment[]).find((key) => key === input.segment) ?? "all";
  const tag = input.tag?.trim();
  const paid = { paidAt: { not: null } } as const;
  const where: Prisma.CustomerWhereInput = {
    erasedAt: null,
    ...(term ? { OR: [{ email: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }, { firstName: { contains: term, mode: "insensitive" } }, { companyName: { contains: term, mode: "insensitive" } }] } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
    ...(segment === "vip" ? { tags: { has: "VIP" } } : {}),
    ...(segment === "wholesale" ? { wholesaleStatus: "APPROVED" } : {}),
    ...(segment === "consent" ? { marketingOptIn: true } : {}),
    ...(segment === "none" ? { orders: { none: paid } } : {}),
  };
  const customers = await ctx.db.customer.findMany({ where, orderBy: { createdAt: "desc" }, take: 300, include: { orders: { where: paid, select: { totalCents: true, paidAt: true } } } });
  const rows = customers
    .map((customer) => {
      const spent = customer.orders.reduce((sum, order) => sum + order.totalCents, 0);
      const last = customer.orders.reduce<Date | null>((latest, order) => (order.paidAt && (!latest || order.paidAt > latest) ? order.paidAt : latest), null);
      return { id: customer.id, name: `${customer.firstName} ${customer.lastName}`, email: customer.email, companyName: customer.companyName, tags: customer.tags, wholesale: customer.wholesaleStatus === "APPROVED", marketingOptIn: customer.marketingOptIn, createdAt: customer.createdAt, paidOrders: customer.orders.length, spentCents: spent, averageCents: customer.orders.length ? Math.round(spent / customer.orders.length) : 0, lastOrderAt: last };
    })
    .filter((row) => segment !== "repeat" || row.paidOrders >= 2);
  const tags = [...new Set((await ctx.db.customer.findMany({ where: { erasedAt: null, NOT: { tags: { isEmpty: true } } }, select: { tags: true } })).flatMap((customer) => customer.tags))].sort();
  return { rows: rows.slice(0, 100), matched: rows.length, segment, tags };
}

/** Everything staff need about one customer: what they bought, spent and were refunded, and what staff have noted. */
export async function customerProfile(ctx: Ctx, id: string) {
  requireAdmin(ctx, "VIEW", "customers");
  const customer = await ctx.db.customer.findUnique({ where: { id }, include: { addresses: true, notes: { orderBy: { createdAt: "desc" } }, orders: { orderBy: { placedAt: "desc" }, include: { payments: { include: { refunds: { where: { failedAt: null } } } }, returns: { select: { id: true } } } } } });
  if (!customer) throw new AppError("NOT_FOUND", "Customer not found.");
  const paid = customer.orders.filter((order) => order.paidAt);
  const spent = paid.reduce((sum, order) => sum + order.totalCents, 0);
  const refunded = customer.orders.flatMap((order) => order.payments.flatMap((payment) => payment.refunds)).reduce((sum, refund) => sum + refund.amountCents, 0);
  const staff = new Map((await ctx.db.adminUser.findMany({ where: { id: { in: customer.notes.map((note) => note.adminUserId).filter((value): value is string => !!value) } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
  return {
    customer,
    notes: customer.notes.map((note) => ({ ...note, by: note.adminUserId ? (staff.get(note.adminUserId) ?? "Former staff") : "System" })),
    metrics: { paidOrders: paid.length, spentCents: spent, lifetimeCents: spent - refunded, averageCents: paid.length ? Math.round(spent / paid.length) : 0, refundedCents: refunded, returns: customer.orders.reduce((sum, order) => sum + order.returns.length, 0), firstOrderAt: paid.at(-1)?.paidAt ?? null, lastOrderAt: paid[0]?.paidAt ?? null },
  };
}

export async function addCustomerNote(ctx: Ctx, customerId: string, body: string) {
  const admin = requireAdmin(ctx, "STAFF", "customers");
  const text = body.trim();
  if (text.length < 1 || text.length > 2000) throw new AppError("BAD_INPUT", "Write a note of up to 2000 characters.");
  if (!(await ctx.db.customer.findFirst({ where: { id: customerId, erasedAt: null }, select: { id: true } }))) throw new AppError("NOT_FOUND", "Customer not found.");
  await ctx.db.customerNote.create({ data: { customerId, adminUserId: admin.id, body: text } });
  await audit(ctx, "customer.note", "Customer", customerId);
}

/** Replaces a customer's tags. Tags are short labels: at most ten, tidied and de-duplicated. */
export async function setCustomerTags(ctx: Ctx, customerId: string, raw: string) {
  requireAdmin(ctx, "STAFF", "customers");
  const tags = [...new Set(raw.split(/[,;\n]+/).map((tag) => tag.trim().replace(/\s+/g, " ")).filter(Boolean).map((tag) => (tag.toLowerCase() === "vip" ? "VIP" : tag.slice(0, 30))))].slice(0, 10);
  const updated = await ctx.db.customer.updateMany({ where: { id: customerId, erasedAt: null }, data: { tags } });
  if (updated.count !== 1) throw new AppError("NOT_FOUND", "Customer not found.");
  await audit(ctx, "customer.tags", "Customer", customerId, { tags });
}
