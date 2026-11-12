import { z } from "zod";
import type { AdminRole, OrderStatus, Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "./auth";
import type { Ctx } from "./context";
import { hashPassword } from "./crypto";
import { AppError, parse } from "./errors";
import { getPaymentProvider } from "./payments";
import { eraseCustomerData } from "./privacy";

/**
 * Administration services.
 *
 * Every function starts with `requireAdmin(ctx, minimumRole)` and every
 * change writes an audit record, so the rules hold no matter which screen or
 * API calls in. Roles, lowest to highest:
 *   STAFF          read everything operational; pack, ship and annotate orders
 *   MANAGER        + catalogue, stock, discounts, shipping rates, returns, exports
 *   ADMINISTRATOR  + refunds, VAT, settings, staff accounts, data erasure
 */

async function audit(ctx: Ctx, action: string, entity: string, entityId: string | null, data?: Prisma.InputJsonValue) {
  await ctx.db.auditLog.create({ data: { actorType: "admin", actorId: ctx.admin?.id ?? null, action, entity, entityId, data, ip: ctx.ip } });
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));
const optionalDate = z
  .string()
  .nullish()
  .transform((value) => (value ? new Date(`${value}T00:00:00Z`) : null));
const cents = z.coerce.number().int().min(0).max(10_000_000);
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.").max(120);

/** Euros typed by a person ("18", "18.5", "18,50") to integer cents. */
export function eurosToCents(input: unknown): number {
  const text = String(input ?? "").trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) throw new AppError("BAD_INPUT", "Enter an amount like 18.50.");
  return Math.round(Number(text) * 100);
}

// ───────────────────────────── Dashboard ─────────────────────────────

const PAID_STATES: OrderStatus[] = ["PAID", "FULFILLING", "SHIPPED", "DELIVERED"];

export async function dashboard(ctx: Ctx) {
  requireAdmin(ctx);
  const { db } = ctx;
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const paid = { status: { in: PAID_STATES } } satisfies Prisma.OrderWhereInput;

  const [total, month, today, recent, customers, newCustomers, bestSellers, daily, lowStock, abandoned, awaiting, cartsWithItems] = await Promise.all([
    db.order.aggregate({ where: paid, _sum: { totalCents: true }, _count: true }),
    db.order.aggregate({ where: { ...paid, paidAt: { gte: startOfMonth } }, _sum: { totalCents: true } }),
    db.order.count({ where: { placedAt: { gte: startOfDay } } }),
    db.order.findMany({ orderBy: { placedAt: "desc" }, take: 8 }),
    db.customer.count({ where: { erasedAt: null } }),
    db.customer.count({ where: { erasedAt: null, createdAt: { gte: startOfMonth } } }),
    db.orderItem.groupBy({ by: ["sku", "productName", "variantLabel"], where: { order: paid }, _sum: { quantity: true, lineTotalCents: true }, orderBy: { _sum: { quantity: "desc" } }, take: 5 }),
    db.$queryRaw<{ day: Date; revenue: bigint; orders: bigint }[]>`
      SELECT date_trunc('day', "paidAt") AS day, SUM("totalCents")::bigint AS revenue, COUNT(*)::bigint AS orders
      FROM "Order" WHERE "paidAt" >= now() - interval '30 days' AND "status" IN ('PAID','FULFILLING','SHIPPED','DELIVERED')
      GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ sku: string; label: string; name: string; available: number }[]>`
      SELECT v."sku", v."label", p."name", (v."stock" - v."reserved")::int AS available
      FROM "Variant" v JOIN "Product" p ON p."id" = v."productId"
      WHERE v."isActive" AND p."deletedAt" IS NULL AND v."stock" - v."reserved" <= v."lowStockThreshold" ORDER BY available ASC LIMIT 10`,
    db.cart.count({ where: { items: { some: {} }, updatedAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } }),
    db.order.count({ where: { status: { in: ["PAID", "FULFILLING"] } } }),
    db.cart.count({ where: { items: { some: {} } } }),
  ]);

  const revenue = total._sum.totalCents ?? 0;
  return {
    revenueCents: revenue,
    paidOrders: total._count,
    monthRevenueCents: month._sum.totalCents ?? 0,
    ordersToday: today,
    averageOrderCents: total._count ? Math.round(revenue / total._count) : 0,
    recent,
    customers,
    newCustomers,
    bestSellers: bestSellers.map((row) => ({ sku: row.sku, name: `${row.productName} ${row.variantLabel}`, units: row._sum.quantity ?? 0, revenueCents: row._sum.lineTotalCents ?? 0 })),
    daily: daily.map((row) => ({ day: row.day.toISOString().slice(0, 10), revenueCents: Number(row.revenue), orders: Number(row.orders) })),
    lowStock,
    abandonedCarts: abandoned,
    openCarts: cartsWithItems,
    awaitingFulfilment: awaiting,
  };
}

// ───────────────────────────── Orders ─────────────────────────────

const orderDetail = { items: true, events: { orderBy: { createdAt: "asc" } }, notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } }, payments: { include: { refunds: true } }, shipments: true, returns: true, customer: true } as const;

export async function listOrders(ctx: Ctx, input: { q?: string; status?: string; page?: number }) {
  requireAdmin(ctx);
  const q = input.q?.trim();
  const where: Prisma.OrderWhereInput = {
    ...(input.status && input.status !== "ALL" ? { status: input.status as OrderStatus } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { shipLastName: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const page = Math.max(1, input.page ?? 1);
  const [rows, count] = await Promise.all([ctx.db.order.findMany({ where, orderBy: { placedAt: "desc" }, take: 25, skip: (page - 1) * 25, include: { items: true } }), ctx.db.order.count({ where })]);
  return { rows, count, page, pages: Math.max(1, Math.ceil(count / 25)) };
}

export async function getOrder(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  const order = await ctx.db.order.findFirst({ where: { OR: [{ id }, { number: id.toUpperCase() }] }, include: orderDetail });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  return order;
}

export async function addOrderNote(ctx: Ctx, orderId: string, body: string) {
  const admin = requireAdmin(ctx);
  const text = body.trim();
  if (text.length < 1 || text.length > 2000) throw new AppError("BAD_INPUT", "Write a note of up to 2000 characters.");
  await ctx.db.orderNote.create({ data: { orderId, adminUserId: admin.id, body: text } });
  await audit(ctx, "order.note", "Order", orderId);
}

/** The lot each line was packed from. Recorded when the parcel is prepared. */
export async function setItemLot(ctx: Ctx, orderItemId: string, lotNumber: string) {
  requireAdmin(ctx);
  const lot = lotNumber.trim().toUpperCase();
  if (lot && !(await ctx.db.batch.findUnique({ where: { lotNumber: lot } }))) throw new AppError("BAD_INPUT", `Lot ${lot} does not exist. Create it under Lots first.`);
  const item = await ctx.db.orderItem.update({ where: { id: orderItemId }, data: { lotNumber: lot || null } });
  await audit(ctx, "order.item.lot", "Order", item.orderId, { orderItemId, lot });
}

export async function startFulfilment(ctx: Ctx, orderId: string) {
  requireAdmin(ctx);
  const changed = await ctx.db.order.updateMany({ where: { id: orderId, status: "PAID" }, data: { status: "FULFILLING" } });
  if (changed.count !== 1) throw new AppError("BAD_INPUT", "Only a paid order can be moved to packing.");
  await ctx.db.orderEvent.create({ data: { orderId, kind: "fulfilling", message: "Your order is being packed." } });
  await audit(ctx, "order.fulfilling", "Order", orderId);
}

const shipInput = z.object({ carrier: z.string().trim().min(1, "Enter the carrier.").max(60), trackingNumber: optionalText(80), trackingUrl: z.string().trim().url("Enter a full tracking link.").max(500).nullish().or(z.literal("")) });

/** Records a shipment entered by hand. Carrier label APIs are connected in Phase 7. */
export async function markShipped(ctx: Ctx, orderId: string, input: unknown) {
  requireAdmin(ctx);
  const data = parse(shipInput, input);
  await ctx.db.$transaction(async (tx) => {
    const changed = await tx.order.updateMany({ where: { id: orderId, status: { in: ["PAID", "FULFILLING"] } }, data: { status: "SHIPPED" } });
    if (changed.count !== 1) throw new AppError("BAD_INPUT", "Only a paid order can be shipped.");
    await tx.shipment.create({ data: { orderId, carrier: data.carrier, trackingNumber: data.trackingNumber, trackingUrl: data.trackingUrl || null, status: "IN_TRANSIT", shippedAt: new Date() } });
    await tx.orderEvent.create({ data: { orderId, kind: "shipped", message: `Shipped with ${data.carrier}.` } });
    await tx.outboxJob.createMany({ data: [{ kind: "notify.customer.shipped", dedupeKey: `notify.customer.shipped:${orderId}`, payload: { orderId } }], skipDuplicates: true });
  });
  await audit(ctx, "order.shipped", "Order", orderId, { carrier: data.carrier, trackingNumber: data.trackingNumber });
}

export async function markDelivered(ctx: Ctx, orderId: string) {
  requireAdmin(ctx);
  await ctx.db.$transaction(async (tx) => {
    const changed = await tx.order.updateMany({ where: { id: orderId, status: "SHIPPED" }, data: { status: "DELIVERED" } });
    if (changed.count !== 1) throw new AppError("BAD_INPUT", "Only a shipped order can be marked delivered.");
    await tx.shipment.updateMany({ where: { orderId }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    await tx.orderEvent.create({ data: { orderId, kind: "delivered", message: "Delivered." } });
  });
  await audit(ctx, "order.delivered", "Order", orderId);
}

/** Cancels an order that has not been paid and returns its held stock to sale. */
export async function cancelUnpaidOrder(ctx: Ctx, orderId: string) {
  requireAdmin(ctx, "MANAGER");
  await ctx.db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    const changed = await tx.order.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED", cancelledAt: new Date(), reservedUntil: null } });
    if (!order || changed.count !== 1) throw new AppError("BAD_INPUT", "Only an unpaid order can be cancelled here. Refund a paid order instead.");
    for (const item of order.items) {
      if (item.variantId) await tx.$executeRaw`UPDATE "Variant" SET "reserved" = GREATEST("reserved" - ${item.quantity}, 0) WHERE "id" = ${item.variantId}`;
    }
    if (order.discountCode) await tx.$executeRaw`UPDATE "Discount" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "code" = ${order.discountCode}`;
    await tx.orderEvent.create({ data: { orderId, kind: "cancelled", message: "Order cancelled." } });
  });
  await audit(ctx, "order.cancelled", "Order", orderId);
}

const refundInput = z.object({ amountCents: cents.min(1, "Enter an amount."), reason: optionalText(300), restock: z.boolean().default(false) });

/**
 * Refunds through the payment provider, then records it. If the provider
 * call fails nothing is recorded, so the books never show money returned
 * that was not. Administrators only.
 */
export async function refundOrder(ctx: Ctx, orderId: string, input: unknown) {
  const admin = requireAdmin(ctx, "ADMINISTRATOR");
  const data = parse(refundInput, input);
  const order = await ctx.db.order.findUnique({ where: { id: orderId }, include: { items: true, payments: { where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, include: { refunds: true } } } });
  const payment = order?.payments[0];
  if (!order || !payment) throw new AppError("BAD_INPUT", "This order has no received payment to refund.");
  const already = payment.refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
  if (data.amountCents > payment.amountCents - already) throw new AppError("BAD_INPUT", "The amount is more than what remains refundable.");

  const provider = getPaymentProvider();
  if (!provider?.refund) throw new AppError("PAYMENT_UNAVAILABLE", "No payment provider is connected, so a refund cannot be sent.");
  const providerRef = await provider.refund({ providerRef: payment.providerRef, amountCents: data.amountCents, idempotencyKey: `refund:${payment.id}:${already}:${data.amountCents}` });

  const full = already + data.amountCents === payment.amountCents;
  await ctx.db.$transaction(async (tx) => {
    await tx.refund.create({ data: { paymentId: payment.id, amountCents: data.amountCents, reason: data.reason, providerRef, adminUserId: admin.id } });
    await tx.payment.update({ where: { id: payment.id }, data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    await tx.order.update({ where: { id: orderId }, data: { paymentStatus: full ? "REFUNDED" : "PARTIALLY_REFUNDED", ...(full ? { status: "REFUNDED" } : {}) } });
    if (data.restock) {
      for (const item of order.items) {
        if (!item.variantId) continue;
        await tx.variant.update({ where: { id: item.variantId }, data: { stock: { increment: item.quantity } } });
        await tx.inventoryMovement.create({ data: { variantId: item.variantId, delta: item.quantity, reason: "RETURN", orderId, adminUserId: admin.id } });
      }
    }
    await tx.orderEvent.create({ data: { orderId, kind: "refunded", message: full ? "Order refunded." : "Partial refund issued." } });
  });
  await audit(ctx, "order.refund", "Order", orderId, { amountCents: data.amountCents, restock: data.restock, providerRef });
}

export async function setReturnStatus(ctx: Ctx, returnId: string, status: "APPROVED" | "REJECTED" | "RECEIVED") {
  requireAdmin(ctx, "MANAGER");
  const updated = await ctx.db.returnRequest.update({ where: { id: returnId }, data: { status } });
  await ctx.db.orderEvent.create({ data: { orderId: updated.orderId, kind: `return_${status.toLowerCase()}`, message: `Return ${status.toLowerCase()}.` } });
  await audit(ctx, "return.status", "ReturnRequest", returnId, { status });
}

// ───────────────────────────── Catalogue ─────────────────────────────

const productInput = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  slug,
  categoryId: z.string().min(1, "Choose a category."),
  blurb: z.string().trim().max(300).default(""),
  description: z.string().trim().max(8000).default(""),
  isVisible: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  seoTitle: optionalText(70),
  seoDescription: optionalText(170),
  origin: optionalText(200),
  cultivar: optionalText(200),
  ingredients: optionalText(500),
  storage: optionalText(500),
});

export async function listProducts(ctx: Ctx) {
  requireAdmin(ctx);
  return ctx.db.product.findMany({ where: { deletedAt: null }, orderBy: [{ position: "asc" }, { name: "asc" }], include: { category: true, variants: { orderBy: { position: "asc" } } } });
}

export async function getProduct(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  const product = await ctx.db.product.findFirst({ where: { id, deletedAt: null }, include: { variants: { orderBy: { position: "asc" } }, batches: { orderBy: { createdAt: "desc" } } } });
  if (!product) throw new AppError("NOT_FOUND", "Product not found.");
  return product;
}

export async function saveProduct(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER");
  const data = parse(productInput, input);
  const clash = await ctx.db.product.findFirst({ where: { slug: data.slug, NOT: id ? { id } : undefined }, select: { id: true } });
  if (clash) throw new AppError("BAD_INPUT", "Another product already uses this web address.", "slug");
  const product = id ? await ctx.db.product.update({ where: { id }, data }) : await ctx.db.product.create({ data });
  await audit(ctx, id ? "product.update" : "product.create", "Product", product.id, { name: data.name, isVisible: data.isVisible });
  return product;
}

/** Soft delete: the product disappears from sale but past orders keep their history. */
export async function deleteProduct(ctx: Ctx, id: string) {
  requireAdmin(ctx, "MANAGER");
  await ctx.db.product.update({ where: { id }, data: { deletedAt: new Date(), isVisible: false, slug: `deleted-${id}` } });
  await audit(ctx, "product.delete", "Product", id);
}

const variantInput = z.object({
  sku: z.string().trim().min(1, "Enter a SKU.").max(40).regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dots, dashes."),
  label: z.string().trim().min(1, "Enter a label.").max(40),
  volumeMl: z.coerce.number().int().min(1).max(100_000),
  priceCents: cents.min(1, "Enter a price."),
  compareAtCents: cents.nullish().transform((value) => value || null),
  weightGrams: z.coerce.number().int().min(1, "Enter the packed weight.").max(100_000),
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).default(6),
  isActive: z.boolean().default(true),
});

export async function saveVariant(ctx: Ctx, productId: string, variantId: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER");
  const data = parse(variantInput, input);
  const clash = await ctx.db.variant.findFirst({ where: { sku: data.sku, NOT: variantId ? { id: variantId } : undefined }, select: { id: true } });
  if (clash) throw new AppError("BAD_INPUT", "Another size already uses this SKU.", "sku");
  const variant = variantId
    ? await ctx.db.variant.update({ where: { id: variantId }, data })
    : await ctx.db.variant.create({ data: { ...data, productId, position: await ctx.db.variant.count({ where: { productId } }) } });
  await audit(ctx, variantId ? "variant.update" : "variant.create", "Variant", variant.id, { sku: data.sku, priceCents: data.priceCents });
  return variant;
}

export async function adjustStock(ctx: Ctx, variantId: string, delta: number, reason: "RECEIVED" | "ADJUSTMENT" | "RETURN" | "DAMAGED", note?: string) {
  const admin = requireAdmin(ctx, "MANAGER");
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100_000) throw new AppError("BAD_INPUT", "Enter a whole number other than zero.");
  await ctx.db.$transaction(async (tx) => {
    const changed = await tx.$executeRaw`UPDATE "Variant" SET "stock" = "stock" + ${delta} WHERE "id" = ${variantId} AND "stock" + ${delta} >= "reserved"`;
    if (changed !== 1) throw new AppError("BAD_INPUT", "That would take stock below the units held by unpaid orders.");
    await tx.inventoryMovement.create({ data: { variantId, delta, reason, adminUserId: admin.id, note: note?.slice(0, 500) } });
  });
  await audit(ctx, "inventory.adjust", "Variant", variantId, { delta, reason });
}

const categoryInput = z.object({ name: z.string().trim().min(1).max(120), slug, intro: z.string().trim().max(500).default(""), isVisible: z.boolean().default(true) });

export async function saveCategory(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER");
  const data = parse(categoryInput, input);
  const category = id ? await ctx.db.category.update({ where: { id }, data }) : await ctx.db.category.create({ data });
  await audit(ctx, id ? "category.update" : "category.create", "Category", category.id);
  return category;
}

const batchInput = z.object({
  lotNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, "Use 3–32 letters, numbers or dashes."),
  productId: z.string().min(1),
  harvestDate: optionalDate,
  grove: optionalText(200),
  mill: optionalText(200),
  milledAt: optionalDate,
  bottledAt: optionalDate,
  bestBefore: optionalDate,
  notes: optionalText(2000),
  isPublished: z.boolean().default(false),
});

/** A lot is the public record behind a label. Publishing makes it visible to anyone with the number. */
export async function saveBatch(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER");
  const data = parse(batchInput, input);
  const clash = await ctx.db.batch.findFirst({ where: { lotNumber: data.lotNumber, NOT: id ? { id } : undefined }, select: { id: true } });
  if (clash) throw new AppError("BAD_INPUT", "This lot number already exists.", "lotNumber");
  const batch = id ? await ctx.db.batch.update({ where: { id }, data }) : await ctx.db.batch.create({ data });
  await audit(ctx, id ? "batch.update" : "batch.create", "Batch", batch.id, { lotNumber: data.lotNumber, isPublished: data.isPublished });
  return batch;
}

// ───────────────────────────── Customers ─────────────────────────────

export async function listCustomers(ctx: Ctx, q?: string) {
  requireAdmin(ctx);
  const term = q?.trim();
  return ctx.db.customer.findMany({
    where: { erasedAt: null, ...(term ? { OR: [{ email: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }, { firstName: { contains: term, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { orders: true } }, orders: { where: { status: { in: PAID_STATES } }, select: { totalCents: true } } },
  });
}

export async function getCustomer(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  const customer = await ctx.db.customer.findUnique({ where: { id }, include: { orders: { orderBy: { placedAt: "desc" } }, addresses: true } });
  if (!customer) throw new AppError("NOT_FOUND", "Customer not found.");
  return customer;
}

/**
 * GDPR erasure. Personal data is removed from the account, its sessions,
 * addresses, favourites and reviews. Orders are kept, because invoices must
 * be retained by law, but are detached from the account.
 */
export async function eraseCustomer(ctx: Ctx, id: string) {
  requireAdmin(ctx, "ADMINISTRATOR");
  await eraseCustomerData(ctx.db, id);
  await audit(ctx, "customer.erase", "Customer", id);
}

/** A cell that starts with = + - @ could run as a formula when the file is opened; such cells are neutralised. */
export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null) => {
    let text = value === null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export async function exportCustomersCsv(ctx: Ctx) {
  requireAdmin(ctx, "MANAGER");
  const customers = await listCustomers(ctx);
  await audit(ctx, "customer.export", "Customer", null, { count: customers.length });
  return toCsv([
    ["Email", "First name", "Last name", "Phone", "Newsletter", "Orders", "Paid total (EUR)", "Joined"],
    ...customers.map((c) => [c.email, c.firstName, c.lastName, c.phone, c.marketingOptIn ? "yes" : "no", c._count.orders, (c.orders.reduce((sum, o) => sum + o.totalCents, 0) / 100).toFixed(2), c.createdAt.toISOString().slice(0, 10)]),
  ]);
}

export async function exportOrdersCsv(ctx: Ctx) {
  requireAdmin(ctx, "MANAGER");
  const orders = await ctx.db.order.findMany({ orderBy: { placedAt: "desc" }, take: 5000 });
  await audit(ctx, "order.export", "Order", null, { count: orders.length });
  return toCsv([
    ["Order", "Placed", "Status", "Payment", "Email", "Country", "Subtotal", "Discount", "Shipping", "VAT", "Total"],
    ...orders.map((o) => [o.number, o.placedAt.toISOString(), o.status, o.paymentStatus, o.email, o.shipCountryCode, o.subtotalCents / 100, o.discountCents / 100, o.shippingCents / 100, o.taxCents === null ? null : o.taxCents / 100, o.totalCents / 100]),
  ]);
}

export async function exportNewsletterCsv(ctx: Ctx) {
  requireAdmin(ctx, "MANAGER");
  const rows = await ctx.db.newsletterSubscriber.findMany({ orderBy: { createdAt: "desc" } });
  await audit(ctx, "newsletter.export", "NewsletterSubscriber", null, { count: rows.length });
  return toCsv([["Email", "Status", "Locale", "Consent given", "Added"], ...rows.map((r) => [r.email, r.status, r.locale, r.consentAt?.toISOString() ?? null, r.createdAt.toISOString()])]);
}

// ───────────────────────────── Marketing, shipping, tax ─────────────────────────────

const discountInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/, "Use 2–40 letters, numbers, dashes."),
  kind: z.enum(["PERCENT", "FIXED", "FREE_SHIPPING"]),
  value: z.coerce.number().int().min(0).max(10_000_000).default(0),
  minSubtotalCents: cents.default(0),
  startsAt: optionalDate,
  endsAt: optionalDate,
  usageLimit: z.coerce.number().int().min(1).nullish().or(z.literal("")).transform((value) => (value ? Number(value) : null)),
  isActive: z.boolean().default(true),
});

export async function saveDiscount(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER");
  const data = parse(discountInput, input);
  if (data.kind === "PERCENT" && (data.value < 1 || data.value > 100)) throw new AppError("BAD_INPUT", "A percentage must be between 1 and 100.", "value");
  const clash = await ctx.db.discount.findFirst({ where: { code: data.code, NOT: id ? { id } : undefined }, select: { id: true } });
  if (clash) throw new AppError("BAD_INPUT", "This code already exists.", "code");
  const discount = id ? await ctx.db.discount.update({ where: { id }, data }) : await ctx.db.discount.create({ data });
  await audit(ctx, id ? "discount.update" : "discount.create", "Discount", discount.id, { code: data.code });
}

const zoneInput = z.object({ name: z.string().trim().min(1).max(120), countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1, "Add at least one country code.").max(60), isActive: z.boolean().default(true) });
const rateInput = z.object({
  name: z.string().trim().min(1).max(120),
  carrier: optionalText(60),
  priceCents: cents,
  minWeightGrams: z.coerce.number().int().min(0).default(0),
  maxWeightGrams: z.coerce.number().int().min(1).nullish().or(z.literal("")).transform((value) => (value ? Number(value) : null)),
  freeAboveCents: cents.nullish().transform((value) => value || null),
  estimate: optionalText(120),
  isActive: z.boolean().default(true),
});

export async function saveZone(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER");
  const data = parse(zoneInput, input);
  const zone = id ? await ctx.db.shippingZone.update({ where: { id }, data }) : await ctx.db.shippingZone.create({ data });
  await audit(ctx, id ? "shipping.zone.update" : "shipping.zone.create", "ShippingZone", zone.id, { countries: data.countries });
}

export async function saveRate(ctx: Ctx, zoneId: string, id: string | null, input: unknown) {
  requireAdmin(ctx, "MANAGER");
  const data = parse(rateInput, input);
  const rate = id ? await ctx.db.shippingRate.update({ where: { id }, data }) : await ctx.db.shippingRate.create({ data: { ...data, zoneId } });
  await audit(ctx, id ? "shipping.rate.update" : "shipping.rate.create", "ShippingRate", rate.id, { priceCents: data.priceCents });
}

export async function deleteRate(ctx: Ctx, id: string) {
  requireAdmin(ctx, "MANAGER");
  await ctx.db.shippingRate.delete({ where: { id } });
  await audit(ctx, "shipping.rate.delete", "ShippingRate", id);
}

const taxInput = z.object({ countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code."), ratePercent: z.coerce.number().min(0).max(40), label: z.string().trim().max(40).default("VAT") });

/** VAT rates have tax consequences, so only administrators set them. */
export async function saveTaxRate(ctx: Ctx, input: unknown) {
  requireAdmin(ctx, "ADMINISTRATOR");
  const data = parse(taxInput, input);
  const rateBps = Math.round(data.ratePercent * 100);
  await ctx.db.taxRate.upsert({ where: { countryCode: data.countryCode }, update: { rateBps, label: data.label, isActive: true }, create: { countryCode: data.countryCode, rateBps, label: data.label } });
  await audit(ctx, "tax.save", "TaxRate", data.countryCode, { rateBps });
}

export async function deleteTaxRate(ctx: Ctx, countryCode: string) {
  requireAdmin(ctx, "ADMINISTRATOR");
  await ctx.db.taxRate.delete({ where: { countryCode } });
  await audit(ctx, "tax.delete", "TaxRate", countryCode);
}

// ───────────────────────────── Settings and staff ─────────────────────────────

export const SETTING_KEYS = ["store", "notifications"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

const settingSchemas = {
  store: z.object({ name: optionalText(120), legalName: optionalText(160), address: optionalText(400), vatNumber: optionalText(40), enterpriseNumber: optionalText(40), email: optionalText(254), phone: optionalText(40) }),
  notifications: z.object({
    emailRecipient: optionalText(254),
    whatsappBusinessNumber: optionalText(40),
    whatsappRecipient: optionalText(40),
    smsRecipient: optionalText(40),
    notifyByEmail: z.boolean().default(true),
    notifyByWhatsapp: z.boolean().default(true),
    notifyBySms: z.boolean().default(false),
  }),
} as const;

export async function getSettings(ctx: Ctx) {
  requireAdmin(ctx);
  const rows = await ctx.db.setting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
  const value = (key: SettingKey) => (rows.find((row) => row.key === key)?.value ?? {}) as Record<string, string | boolean | null>;
  return { store: value("store"), notifications: value("notifications") };
}

export async function saveSetting(ctx: Ctx, key: SettingKey, input: unknown) {
  requireAdmin(ctx, "ADMINISTRATOR");
  const value = parse(settingSchemas[key], input);
  await ctx.db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  await audit(ctx, "setting.save", "Setting", key);
}

const staffInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["ADMINISTRATOR", "MANAGER", "STAFF"]),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
});

export async function createStaff(ctx: Ctx, input: unknown) {
  requireAdmin(ctx, "ADMINISTRATOR");
  const data = parse(staffInput, input);
  if (await ctx.db.adminUser.findUnique({ where: { email: data.email } })) throw new AppError("EMAIL_TAKEN", "A staff account with this email already exists.", "email");
  const user = await ctx.db.adminUser.create({ data: { email: data.email, name: data.name, role: data.role, passwordHash: await hashPassword(data.password) } });
  await audit(ctx, "staff.create", "AdminUser", user.id, { email: data.email, role: data.role });
}

export async function updateStaff(ctx: Ctx, id: string, change: { role?: AdminRole; isActive?: boolean }) {
  const admin = requireAdmin(ctx, "ADMINISTRATOR");
  if (id === admin.id) throw new AppError("BAD_INPUT", "You cannot change your own role or deactivate yourself.");
  const losesAdmin = change.isActive === false || (change.role && change.role !== "ADMINISTRATOR");
  if (losesAdmin) {
    const others = await ctx.db.adminUser.count({ where: { role: "ADMINISTRATOR", isActive: true, NOT: { id } } });
    if (others === 0) throw new AppError("BAD_INPUT", "There must always be at least one active administrator.");
  }
  await ctx.db.adminUser.update({ where: { id }, data: change });
  if (change.isActive === false) await ctx.db.adminSession.deleteMany({ where: { adminUserId: id } });
  await audit(ctx, "staff.update", "AdminUser", id, change);
}
