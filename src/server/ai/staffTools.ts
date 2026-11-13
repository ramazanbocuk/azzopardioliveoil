import { z } from "zod";
import { addOrderNote, getOrder, listCustomers, listOrders, paidByCurrency } from "../admin";
import { listSupportRequests, saveArticle } from "../assistantAdmin";
import { inventoryOverview, salesReport } from "../backoffice";
import { requireAdmin } from "../auth";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import { listBackorders, openBackorder, ordersAwaitingFurtherShipment, outstanding, readyToShip } from "../stock";
import { shipmentWatchlist } from "../tracking";
import { findTranslatable, mergeTranslationDraft } from "../translations";
import type { AnyTool, Outcome } from "./engine";
import { PROPOSAL_KINDS, createProposal, proposalReference, type ProposalKind } from "./proposals";
import type { ToolSpec } from "./provider";

/**
 * What the staff assistant can do. This list is the whole of it.
 *
 * Every tool calls the same service the admin panel calls, with the session
 * of the staff member it is talking to. So the assistant sees and does
 * exactly what that person's role allows, no more: a refusal from
 * `requireAdmin` comes back to the model as "Your role does not allow this
 * action."
 *
 * Three tiers:
 *   read     looks something up. Changes nothing.
 *   draft    writes something only staff can see: an unsent email shown on
 *            screen, an unpublished article, a translation draft, an
 *            internal order note. Nothing reaches a customer.
 *   propose  asks a person to approve one change to money, stock or an
 *            order. The assistant cannot make the change (see proposals.ts).
 *
 * There is no tool for deleting anything, tax, staff accounts, roles,
 * settings, addresses, payment details, prices or publishing.
 */

export type Tier = "read" | "draft" | "propose";
export type StaffActions = {
  drafts: { to: string; subject: string; body: string }[];
  proposals: { id: string; reference: string; label: string; summary: string }[];
  links: { label: string; href: string }[];
};
export const noStaffActions = (): StaffActions => ({ drafts: [], proposals: [], links: [] });
export type StaffContext = { ctx: Ctx; conversationId: string; actions: StaffActions };
type Tool = AnyTool<StaffContext> & { tier: Tier };

const object = (properties: Record<string, unknown>): ToolSpec["input_schema"] => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const nullable = (type: string, description: string) => ({ type: [type, "null"], description });
/** An amount with its currency. Euro keeps its sign; any other currency is written out, so it cannot be misread as euro. */
const amount = (cents: number, currency = "EUR") => (currency === "EUR" ? `€${(cents / 100).toFixed(2)}` : `${(cents / 100).toFixed(2)} ${currency}`);
const day = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const link = (actions: StaffActions, label: string, href: string) => {
  if (!actions.links.some((entry) => entry.href === href) && actions.links.length < 12) actions.links.push({ label, href });
  return href;
};

// ───────────────────────────── read ─────────────────────────────

const findOrders: Tool = {
  tier: "read",
  spec: {
    name: "find_orders",
    description: "Search orders, newest first. Returns up to 25 with their payment and dispatch state. Use it to find an order by number, customer name, email, SKU or tracking number, or to list orders in a state or a period.",
    input_schema: object({
      query: nullable("string", "Order number, customer name, email, company, SKU or tracking number. Null for no text search."),
      payment: nullable("string", "UNPAID, PROCESSING, PAID, PARTIALLY_REFUNDED, REFUNDED or FAILED. Null for any."),
      dispatch: nullable("string", "UNFULFILLED, PROCESSING, READY, PARTIALLY_SHIPPED, SHIPPED or DELIVERED. Null for any."),
      fromDate: nullable("string", "First day placed, YYYY-MM-DD. Null for no limit."),
      toDate: nullable("string", "Last day placed, YYYY-MM-DD. Null for no limit."),
    }),
  },
  async run(input, { ctx, actions }) {
    const data = z.object({ query: z.string().max(120).nullable(), payment: z.string().max(30).nullable(), dispatch: z.string().max(30).nullable(), fromDate: dateInput, toDate: dateInput }).parse(input);
    const found = await listOrders(ctx, { q: data.query, payment: data.payment, fulfilment: data.dispatch, from: data.fromDate, to: data.toDate });
    return {
      result: {
        matching: found.count,
        shown: found.rows.length,
        orders: found.rows.map((order) => ({ number: order.number, placed: day(order.placedAt), customer: `${order.shipFirstName} ${order.shipLastName}`, country: order.shipCountryCode, total: amount(order.totalCents, order.currency), payment: order.paymentStatus, dispatch: order.fulfilmentStatus, cancelled: !!order.cancelledAt, units: order.items.reduce((sum, item) => sum + item.quantity, 0), page: link(actions, `Order ${order.number}`, `/admin/orders/${order.id}`) })),
        note: found.count > found.rows.length ? "More orders match than are shown. Narrow the search, or tell the person to open the orders screen." : undefined,
      },
    };
  },
};

const getOrderTool: Tool = {
  tier: "read",
  spec: {
    name: "get_order",
    description: "Everything about one order: lines with what has been sent, what is ready and what is waiting for stock; every shipment with its tracking; what was paid and refunded and what remains refundable; staff notes. Call this before proposing anything on an order.",
    input_schema: object({ orderNumber: { type: "string", description: "The order number, such as AZZ-10042." } }),
  },
  async run(input, { ctx, actions }) {
    const { orderNumber } = z.object({ orderNumber: z.string().min(3).max(30) }).parse(input);
    const order = await getOrder(ctx, orderNumber.trim().replace(/^#/, ""));
    const shipments = order.shipments.filter((shipment) => !shipment.cancelledAt);
    const euros = (cents: number) => amount(cents, order.currency);
    const nameOf = new Map(order.items.map((item) => [item.id, `${item.productName} ${item.variantLabel}`]));
    const payment = order.payments.find((entry) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(entry.status)) ?? null;
    const refunded = payment ? payment.refunds.filter((refund) => refund.failedAt === null).reduce((sum, refund) => sum + refund.amountCents, 0) : 0;
    return {
      result: {
        number: order.number,
        page: link(actions, `Order ${order.number}`, `/admin/orders/${order.id}`),
        placed: day(order.placedAt),
        customer: { name: `${order.shipFirstName} ${order.shipLastName}`, email: order.email, country: order.shipCountryCode },
        state: { order: order.status, payment: order.paymentStatus, dispatch: order.fulfilmentStatus, cancelled: !!order.cancelledAt },
        total: euros(order.totalCents),
        lines: order.items.map((item) => ({ sku: item.sku, name: `${item.productName} ${item.variantLabel}`, ordered: item.quantity, sent: item.shippedQuantity, takenOffTheOrder: item.cancelledQuantity, stillToSend: outstanding(item), readyToSendNow: readyToShip(item), waitingForStock: openBackorder(item.backorder), unitPrice: euros(item.unitPriceCents) })),
        shipments: shipments.map((shipment, index) => ({
          shipment: `${index + 1} of ${shipments.length}`,
          contains: shipment.items.map((line) => `${line.quantity} × ${nameOf.get(line.orderItemId) ?? "item"}`),
          carrier: shipment.carrier,
          trackingNumber: shipment.trackingNumber ?? "none recorded",
          status: shipment.status,
          sent: day(shipment.shippedAt),
          delivered: day(shipment.deliveredAt),
          carrierEstimate: day(shipment.estimatedDeliveryAt) ?? "none given",
          problem: shipment.exceptionAt ? (shipment.exceptionNote ?? "The carrier reports a problem.") : null,
          latestUpdate: shipment.events.at(-1)?.description ?? null,
        })),
        money: payment
          ? { paid: euros(payment.amountCents), refunded: euros(refunded), stillRefundable: euros(payment.amountCents - refunded), refunds: payment.refunds.map((refund) => ({ amount: euros(refund.amountCents), on: day(refund.createdAt), reason: refund.reason ?? "none recorded", bounced: refund.failedAt !== null })), openDisputes: payment.disputes.length }
          : "No payment has been received for this order.",
        staffNotes: order.notes.slice(0, 5).map((note) => ({ on: day(note.createdAt), by: note.author?.name ?? "Former staff", note: note.body })),
      },
    };
  },
};

const awaitingShipment: Tool = {
  tier: "read",
  spec: {
    name: "orders_awaiting_further_shipment",
    description: "Paid orders of which part has been sent and part has not: the orders waiting for a second or later shipment. For each, what is still to send, how much of it is on the shelf now, and how much is waiting for stock.",
    input_schema: object({}),
  },
  async run(_input, { ctx, actions }) {
    const orders = await ordersAwaitingFurtherShipment(ctx);
    return {
      result: {
        count: orders.length,
        orders: orders.map((order) => ({ number: order.number, customer: order.customer, country: order.country, paid: day(order.paidAt), shipmentsSentSoFar: order.shipmentsSent, lastShipmentSent: day(order.lastShipmentAt), stillToSend: order.lines, canBeSentNow: order.unitsReadyNow > 0 ? `${order.unitsReadyNow} unit(s) are on the shelf and can be sent now` : "nothing: every remaining unit is waiting for stock", page: link(actions, `Order ${order.number}`, `/admin/orders/${order.id}`) })),
        note: orders.length === 0 ? "No order is waiting for a further shipment." : undefined,
      },
    };
  },
};

const backorders: Tool = {
  tier: "read",
  spec: { name: "list_backorders", description: "Paid units still waiting for stock, oldest first, and per SKU how many are needed to fill them all.", input_schema: object({}) },
  async run(_input, { ctx, actions }) {
    const data = await listBackorders(ctx);
    link(actions, "Backorders", "/admin/backorders");
    return { result: { unitsWaiting: data.units, toReplenish: data.replenish, lines: data.lines.slice(0, 50).map((line) => ({ order: line.number, customer: line.customer, country: line.country, sku: line.sku, name: line.name, waiting: line.open, since: day(line.since) })), note: data.lines.length > 50 ? "Only the 50 oldest lines are shown." : undefined } };
  },
};

const deliveryProblems: Tool = {
  tier: "read",
  spec: { name: "delivery_problems", description: "Shipments that need a person's attention: a problem reported by the carrier, late against the carrier's estimate, not collected, silent for days, or sent without a tracking number. Also counts of what is on the road.", input_schema: object({}) },
  async run(_input, { ctx, actions }) {
    const data = await shipmentWatchlist(ctx);
    return {
      result: {
        onTheRoad: data.inTransit,
        awaitingCollection: data.awaitingCollection,
        needAttention: data.attention.length,
        shipments: data.attention.slice(0, 40).map((row) => ({ order: row.number, customer: row.customer, country: row.country, carrier: row.carrier, trackingNumber: row.trackingNumber ?? "none recorded", status: row.status, sent: day(row.sentAt), carrierEstimate: day(row.estimatedDeliveryAt) ?? "none given", why: row.reasons, page: link(actions, `Order ${row.number}`, `/admin/orders/${row.orderId}`) })),
      },
    };
  },
};

const stockLevels: Tool = {
  tier: "read",
  spec: { name: "stock_levels", description: "Units on hand per size (SKU): on the shelf, held for unpaid orders, free to sell, and whether that is at or below its low-stock threshold.", input_schema: object({ lowOnly: { type: "boolean", description: "True to list only sizes at or below their low-stock threshold." } }) },
  async run(input, { ctx, actions }) {
    const { lowOnly } = z.object({ lowOnly: z.boolean() }).parse(input);
    const data = await inventoryOverview(ctx);
    link(actions, "Inventory", "/admin/inventory");
    const rows = data.rows.filter((row) => !lowOnly || row.low);
    return { result: { sizesLow: data.lowCount, sizes: rows.slice(0, 80).map((row) => ({ sku: row.sku, name: `${row.product.name} ${row.label}`, onHand: row.stock, heldForUnpaidOrders: row.reserved, freeToSell: row.available, lowStockThreshold: row.lowStockThreshold, low: row.low, onSale: row.isActive })) } };
  },
};

const salesSummary: Tool = {
  tier: "read",
  spec: { name: "sales_summary", description: "Sales for a period in ONE currency, counted by payment date: orders, gross, VAT, shipping charged, discounts, refunds, average order, best-selling sizes and countries. Null dates give the current month; null currency gives euro. Amounts in different currencies must never be added together: ask once per currency and report them separately.", input_schema: object({ fromDate: nullable("string", "First day, YYYY-MM-DD."), toDate: nullable("string", "Last day, YYYY-MM-DD."), currency: nullable("string", "EUR, USD or GBP. Null for euro.") }) },
  async run(input, { ctx, actions }) {
    const data = z.object({ fromDate: dateInput, toDate: dateInput, currency: z.enum(["EUR", "USD", "GBP"]).nullable() }).parse(input);
    const report = await salesReport(ctx, { from: data.fromDate ?? undefined, to: data.toDate ?? undefined, currency: data.currency ?? undefined });
    const euros = (cents: number) => amount(cents, report.currency);
    link(actions, "Sales report", "/admin/reports");
    return {
      result: {
        period: { from: day(report.range.from), to: day(report.range.to) },
        currency: report.currency,
        otherCurrenciesWithSales: report.currencies.filter((code) => code !== report.currency),
        paidOrders: report.orders,
        gross: euros(report.grossCents),
        vat: euros(report.taxCents),
        ordersWithNoVatRecorded: report.ordersWithoutVat,
        shippingCharged: euros(report.shippingCents),
        discounts: euros(report.discountCents),
        refunded: euros(report.refundedCents),
        refunds: report.refundCount,
        averageOrder: euros(report.averageOrderCents),
        unitsSold: report.units,
        bestSellers: report.products.slice(0, 10).map((row) => ({ sku: row.sku, name: row.name, units: row.units, gross: euros(row.grossCents) })),
        countries: report.countries.slice(0, 10).map((row) => ({ country: row.country, orders: row.orders, gross: euros(row.grossCents) })),
      },
    };
  },
};

const supportRequests: Tool = {
  tier: "read",
  spec: { name: "list_support_requests", description: "Questions customers asked that were passed to a person, with the customer's address and the summary.", input_schema: object({ status: nullable("string", "OPEN, ANSWERED or CLOSED. Null for all.") }) },
  async run(input, { ctx, actions }) {
    const { status } = z.object({ status: z.string().max(20).nullable() }).parse(input);
    const data = await listSupportRequests(ctx, status ?? undefined);
    link(actions, "Support requests", "/admin/support");
    return { result: { waitingForAReply: data.open, ofWhichUrgent: data.urgent, requests: data.rows.slice(0, 30).map((row) => ({ reference: row.reference, received: day(row.createdAt), status: row.status, urgent: row.urgent, from: row.name ?? "no name given", email: row.email, language: row.locale, order: row.orderNumber ?? "none given", subject: row.subject, summary: row.body.slice(0, 1200), handledBy: row.handledBy })) } };
  },
};

const findCustomers: Tool = {
  tier: "read",
  spec: { name: "find_customers", description: "Search customer accounts by name or email. Returns how many orders each has and what they have paid in total.", input_schema: object({ query: { type: "string", description: "Part of a name or an email address." } }) },
  async run(input, { ctx, actions }) {
    const { query } = z.object({ query: z.string().min(2).max(120) }).parse(input);
    const rows = await listCustomers(ctx, query);
    return { result: { found: rows.length, customers: rows.slice(0, 20).map((row) => ({ name: `${row.firstName} ${row.lastName}`, email: row.email, since: day(row.createdAt), orders: row._count.orders, paidInTotal: paidByCurrency(row.orders) || "nothing", page: link(actions, `${row.firstName} ${row.lastName}`, `/admin/customers/${row.id}`) })) } };
  },
};

const translatableText: Tool = {
  tier: "read",
  spec: {
    name: "get_text_to_translate",
    description: "The English text of a product, category or journal article, with the current draft in another language and its state. Call this before draft_translation.",
    input_schema: object({ kind: { type: "string", enum: ["product", "category", "journal"] }, slug: { type: "string", description: "The record's address name, as in its web address." }, language: { type: "string", enum: ["de", "nl", "fr", "it", "es"] } }),
  },
  async run(input, { ctx }) {
    const data = z.object({ kind: z.enum(["product", "category", "journal"]), slug: z.string().min(1).max(160), language: z.enum(["de", "nl", "fr", "it", "es"]) }).parse(input);
    const found = await findTranslatable(ctx, data.kind, data.slug, data.language);
    return {
      result: {
        title: found.title,
        state: found.stateText,
        fields: found.fields.map((field) => ({ key: field.key, label: field.label, maxCharacters: field.max, english: found.english[field.key] ?? "", currentDraft: found.draft[field.key] ?? "", mayBeDrafted: !field.regulated })),
        note: "Fields with mayBeDrafted false are food-label wording: a person writes those. A draft is not shown to customers until a manager publishes it on the translations screen.",
      },
    };
  },
};

// ───────────────────────────── draft ─────────────────────────────

const draftEmail: Tool = {
  tier: "draft",
  spec: {
    name: "draft_email",
    description: "Shows the person an email draft they can copy into the shop's mailbox. Nothing is sent: you cannot send email. Use it for a reply to a customer or a note to a supplier.",
    input_schema: object({ to: { type: "string", description: "The recipient's email address, taken from a tool result." }, subject: { type: "string" }, body: { type: "string", description: "The whole email as plain text, in the recipient's language." } }),
  },
  async run(input, { actions }) {
    const data = z.object({ to: z.string().email().max(200), subject: z.string().min(1).max(200), body: z.string().min(1).max(6000) }).parse(input);
    if (actions.drafts.length >= 3) return { result: { error: "Three drafts are already on screen in this answer." }, isError: true };
    actions.drafts.push(data);
    return { result: { shown: true, note: "The draft is on the person's screen. It has NOT been sent. Say so, and ask them to read it before sending it themselves." } };
  },
};

const draftTranslation: Tool = {
  tier: "draft",
  spec: {
    name: "draft_translation",
    description: "Saves your translation of some fields as a DRAFT. It is not shown to customers: a manager reads and publishes it on the translations screen. Food-label fields are refused. Translate what the English says; add no claim, number or fact that is not in it.",
    input_schema: object({
      kind: { type: "string", enum: ["product", "category", "journal"] },
      slug: { type: "string" },
      language: { type: "string", enum: ["de", "nl", "fr", "it", "es"] },
      fields: { type: "array", description: "The fields you translated.", items: { type: "object", properties: { key: { type: "string" }, text: { type: "string" } }, required: ["key", "text"], additionalProperties: false } },
    }),
  },
  async run(input, { ctx, actions }) {
    const data = z.object({ kind: z.enum(["product", "category", "journal"]), slug: z.string().min(1).max(160), language: z.enum(["de", "nl", "fr", "it", "es"]), fields: z.array(z.object({ key: z.string().max(60), text: z.string().max(40_000) })).min(1).max(30) }).parse(input);
    const saved = await mergeTranslationDraft(ctx, data.kind, data.slug, data.language, Object.fromEntries(data.fields.map((field) => [field.key, field.text])));
    const page = link(actions, `Translation of ${saved.title} (${data.language})`, `/admin/translations/${data.kind}/${saved.id}/${data.language}`);
    return { result: { savedAsDraft: saved.saved, page, note: "Saved as a draft. It is NOT published. Tell the person a manager must read it and publish it, and that it has had no native-speaker check." } };
  },
};

const slugOf = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "article";

const draftArticle: Tool = {
  tier: "draft",
  spec: {
    name: "draft_knowledge_article",
    description: "Saves an UNPUBLISHED knowledge-base article for a manager to check and publish. The customer assistant quotes only published articles. Write only what the person told you or a tool returned; no health claims.",
    input_schema: object({ title: { type: "string" }, body: { type: "string" }, audience: { type: "string", enum: ["customer", "staff"] } }),
  },
  async run(input, { ctx, actions }) {
    const data = z.object({ title: z.string().min(3).max(160), body: z.string().min(20).max(12_000), audience: z.enum(["customer", "staff"]) }).parse(input);
    const base = slugOf(data.title);
    const taken = await ctx.db.knowledgeArticle.count({ where: { slug: { startsWith: base } } });
    const article = await saveArticle(ctx, null, { title: data.title, slug: taken ? `${base}-${taken + 1}`.slice(0, 120) : base, body: data.body, audience: data.audience, isPublished: false });
    return { result: { savedUnpublished: true, page: link(actions, `Article: ${article.title}`, "/admin/knowledge"), note: "Saved, NOT published. Tell the person it must be read and published by a manager." } };
  },
};

const orderNote: Tool = {
  tier: "draft",
  spec: { name: "add_order_note", description: "Adds an internal note to an order, in the person's name. Customers never see staff notes. Use it only when the person asks you to note something.", input_schema: object({ orderNumber: { type: "string" }, note: { type: "string" } }) },
  async run(input, { ctx, actions }) {
    const data = z.object({ orderNumber: z.string().min(3).max(30), note: z.string().min(1).max(1900) }).parse(input);
    const order = await getOrder(ctx, data.orderNumber.trim().replace(/^#/, ""));
    await addOrderNote(ctx, order.id, `[Written by the assistant] ${data.note}`);
    return { result: { added: true, page: link(actions, `Order ${order.number}`, `/admin/orders/${order.id}`) } };
  },
};

// ───────────────────────────── propose ─────────────────────────────

/** Asked before a propose tool looks anything up, so a person without the role learns nothing from it, not even whether a record exists. */
const mayPropose = (ctx: Ctx, kind: ProposalKind) => requireAdmin(ctx, PROPOSAL_KINDS[kind].level, PROPOSAL_KINDS[kind].area);

async function propose(context: StaffContext, kind: ProposalKind, params: unknown): Promise<Outcome> {
  const { proposal, existing } = await createProposal(context.ctx, context.conversationId, kind, params);
  const reference = proposalReference(proposal.sequence);
  if (!context.actions.proposals.some((entry) => entry.id === proposal.id)) context.actions.proposals.push({ id: proposal.id, reference, label: PROPOSAL_KINDS[kind].label, summary: proposal.summary });
  return { result: { reference, status: "WAITING FOR THE PERSON'S APPROVAL", whatApprovingWillDo: proposal.summary, note: `${existing ? "This was already proposed. " : ""}Nothing has been done. The person sees an Approve and a Reject button. Tell them it is waiting for their decision; never say it has been done.` } };
}

const amountInput = z.string().regex(/^\d{1,6}([.,]\d{1,2})?$/);

const proposeRefund: Tool = {
  tier: "propose",
  spec: {
    name: "propose_refund",
    description: "Asks the person to approve a refund through the payment provider. You cannot refund. Call get_order first and use its figures. Only for a person who has asked for a refund and named the amount, or said 'in full'.",
    input_schema: object({ orderNumber: { type: "string" }, amountEuros: { type: "string", description: "The amount, such as 18.50, in the currency the order was paid in (get_order shows it). Never convert between currencies." }, reason: nullable("string", "Why, in a few words, as the person gave it."), putUnitsBackInStock: { type: "boolean", description: "True only if the person said the goods are back or were never sent." } }),
  },
  async run(input, context) {
    mayPropose(context.ctx, "refund");
    const data = z.object({ orderNumber: z.string().min(3).max(30), amountEuros: amountInput, reason: z.string().max(300).nullable(), putUnitsBackInStock: z.boolean() }).parse(input);
    const order = await context.ctx.db.order.findFirst({ where: { number: data.orderNumber.trim().replace(/^#/, "").toUpperCase() }, select: { id: true, number: true, currency: true } });
    if (!order) throw new AppError("NOT_FOUND", "Order not found.");
    return propose(context, "refund", { orderId: order.id, orderNumber: order.number, currency: order.currency, amountCents: Math.round(Number(data.amountEuros.replace(",", ".")) * 100), reason: data.reason, restock: data.putUnitsBackInStock });
  },
};

const proposeCancelUnits: Tool = {
  tier: "propose",
  spec: {
    name: "propose_cancel_units",
    description: "Asks the person to approve taking units that have not been sent off a paid order, because they will not be supplied. No money moves: a refund is a separate proposal.",
    input_schema: object({ orderNumber: { type: "string" }, sku: { type: "string" }, quantity: { type: "integer" } }),
  },
  async run(input, context) {
    mayPropose(context.ctx, "cancel_units");
    const data = z.object({ orderNumber: z.string().min(3).max(30), sku: z.string().min(1).max(60), quantity: z.number().int().min(1).max(10_000) }).parse(input);
    const item = await context.ctx.db.orderItem.findFirst({ where: { sku: { equals: data.sku.trim(), mode: "insensitive" }, order: { number: data.orderNumber.trim().replace(/^#/, "").toUpperCase() } }, select: { id: true, sku: true, orderId: true, order: { select: { number: true, currency: true } } } });
    if (!item) throw new AppError("NOT_FOUND", "That order has no line with that SKU.");
    return propose(context, "cancel_units", { orderId: item.orderId, orderNumber: item.order.number, currency: item.order.currency, orderItemId: item.id, sku: item.sku, quantity: data.quantity });
  },
};

const proposeStock: Tool = {
  tier: "propose",
  spec: {
    name: "propose_stock_adjustment",
    description: "Asks the person to approve adding or removing units of one size. Use the count the person gave; never one you worked out yourself.",
    input_schema: object({ sku: { type: "string" }, change: { type: "integer", description: "Units to add (positive) or remove (negative)." }, reason: { type: "string", enum: ["RECEIVED", "ADJUSTMENT", "RETURN", "DAMAGED"] }, note: nullable("string", "A short note for the stock record.") }),
  },
  async run(input, context) {
    mayPropose(context.ctx, "stock_adjustment");
    const data = z.object({ sku: z.string().min(1).max(60), change: z.number().int(), reason: z.enum(["RECEIVED", "ADJUSTMENT", "RETURN", "DAMAGED"]), note: z.string().max(500).nullable() }).parse(input);
    const variant = await context.ctx.db.variant.findFirst({ where: { sku: { equals: data.sku.trim(), mode: "insensitive" }, product: { deletedAt: null } }, select: { id: true, sku: true } });
    if (!variant) throw new AppError("NOT_FOUND", "No size with that SKU.");
    return propose(context, "stock_adjustment", { variantId: variant.id, sku: variant.sku, delta: data.change, reason: data.reason, note: data.note });
  },
};

const proposeSupport: Tool = {
  tier: "propose",
  spec: {
    name: "propose_support_status",
    description: "Asks the person to approve marking a support request answered, closed or open again. Nothing is sent to the customer.",
    input_schema: object({ reference: { type: "string", description: "Such as S-00012." }, status: { type: "string", enum: ["OPEN", "ANSWERED", "CLOSED"] }, note: nullable("string", "A note for colleagues.") }),
  },
  async run(input, context) {
    mayPropose(context.ctx, "support_status");
    const data = z.object({ reference: z.string().regex(/^S-\d{1,9}$/i), status: z.enum(["OPEN", "ANSWERED", "CLOSED"]), note: z.string().max(2000).nullable() }).parse(input);
    const request = await context.ctx.db.supportRequest.findUnique({ where: { sequence: Number(data.reference.slice(2)) }, select: { id: true } });
    if (!request) throw new AppError("NOT_FOUND", "No support request with that reference.");
    return propose(context, "support_status", { requestId: request.id, reference: data.reference.toUpperCase(), status: data.status, note: data.note });
  },
};

export const STAFF_TOOLS: Tool[] = [findOrders, getOrderTool, awaitingShipment, backorders, deliveryProblems, stockLevels, salesSummary, supportRequests, findCustomers, translatableText, draftEmail, draftTranslation, draftArticle, orderNote, proposeRefund, proposeCancelUnits, proposeStock, proposeSupport];
export const TIER_TEXT: Record<Tier, string> = { read: "Looks something up. Changes nothing.", draft: "Writes something only staff can see. Nothing reaches a customer.", propose: "Asks a person to approve one change. The assistant cannot make it." };
