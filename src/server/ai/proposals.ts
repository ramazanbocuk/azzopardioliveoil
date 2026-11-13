import { z } from "zod";
import type { AiProposal, Prisma } from "@/generated/prisma/client";
import { adjustStock, refundOrder } from "../admin";
import { setSupportStatus } from "../assistantAdmin";
import { requireAdmin } from "../auth";
import type { Ctx } from "../context";
import { AppError } from "../errors";
import type { Area, Level } from "../permissions";
import { cancelOutstanding, outstanding } from "../stock";

/**
 * Things the staff assistant may suggest but never do.
 *
 * The model can only create a PROPOSAL: a row describing one change. A
 * person then approves or rejects it on screen. Approval runs the same
 * service the admin panel's own button runs, as the person who approved,
 * so the role check, the validation and the audit record are the ordinary
 * ones. The model never holds a way to make the change itself.
 *
 * What a proposal says it will do is written here, from the database, not
 * by the model: the person approving reads facts, not the model's summary
 * of them.
 *
 * Only the four kinds below exist. Deleting products, tax rates, staff
 * accounts and roles, settings, addresses, payment details and publishing
 * are not among them and cannot be proposed.
 */

export const PROPOSAL_HOURS = 24;
const MAX_PENDING = 10;
const euros = (cents: number) => `€${(cents / 100).toFixed(2)}`;
export const proposalReference = (sequence: number) => `P-${String(sequence).padStart(5, "0")}`;

const refundParams = z.object({ orderId: z.string(), orderNumber: z.string(), amountCents: z.number().int().min(1), reason: z.string().max(300).nullable(), restock: z.boolean() });
const cancelParams = z.object({ orderId: z.string(), orderNumber: z.string(), orderItemId: z.string(), sku: z.string(), quantity: z.number().int().min(1) });
const stockParams = z.object({ variantId: z.string(), sku: z.string(), delta: z.number().int(), reason: z.enum(["RECEIVED", "ADJUSTMENT", "RETURN", "DAMAGED"]), note: z.string().max(500).nullable() });
const supportParams = z.object({ requestId: z.string(), reference: z.string(), status: z.enum(["OPEN", "ANSWERED", "CLOSED"]), note: z.string().max(2000).nullable() });

type Kind<P> = {
  label: string;
  /** What the person must hold to ask for it and to approve it: the same as the admin panel's own button. */
  level: Level;
  area: Area;
  params: z.ZodType<P>;
  /** Checks the request against the database and says, in facts, what approving it will do. */
  describe(ctx: Ctx, params: P): Promise<string>;
  execute(ctx: Ctx, params: P): Promise<string>;
  /** Where to look afterwards. */
  path(params: P): string;
};
const kind = <P>(definition: Kind<P>) => definition as Kind<unknown>;

export const PROPOSAL_KINDS = {
  refund: kind({
    label: "Refund",
    level: "ADMINISTRATOR",
    area: "payments",
    params: refundParams,
    async describe(ctx, params) {
      const order = await ctx.db.order.findUnique({ where: { id: params.orderId }, select: { number: true, email: true, payments: { where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, include: { refunds: true } } } });
      const payment = order?.payments[0];
      if (!order || !payment) throw new AppError("BAD_INPUT", "This order has no received payment to refund.");
      const already = payment.refunds.filter((refund) => refund.failedAt === null).reduce((sum, refund) => sum + refund.amountCents, 0);
      const refundable = payment.amountCents - already;
      if (params.amountCents > refundable) throw new AppError("BAD_INPUT", `The amount is more than what remains refundable (${euros(refundable)}).`);
      return [
        `Refund ${euros(params.amountCents)} on order ${order.number} to ${order.email}, through the payment provider.`,
        `Paid ${euros(payment.amountCents)}; already refunded ${euros(already)}; ${euros(refundable - params.amountCents)} would remain refundable.`,
        params.restock ? "The order's units are put back into stock." : "Stock is not changed.",
        params.reason ? `Reason: ${params.reason}` : "No reason given.",
        "The customer is emailed. A refund cannot be taken back.",
      ].join(" ");
    },
    async execute(ctx, params) {
      await refundOrder(ctx, params.orderId, { amountCents: params.amountCents, reason: params.reason ?? undefined, restock: params.restock });
      return `${euros(params.amountCents)} refunded on order ${params.orderNumber}.`;
    },
    path: (params) => `/admin/orders/${params.orderId}`,
  }),
  cancel_units: kind({
    label: "Take units off an order",
    level: "MANAGER",
    area: "orders",
    params: cancelParams,
    async describe(ctx, params) {
      const item = await ctx.db.orderItem.findUnique({ where: { id: params.orderItemId }, include: { order: { select: { number: true } } } });
      if (!item || item.orderId !== params.orderId) throw new AppError("NOT_FOUND", "That line is not part of the order.");
      if (params.quantity > outstanding(item)) throw new AppError("BAD_INPUT", `${item.productName} ${item.variantLabel}: only ${outstanding(item)} not yet shipped.`);
      return `Take ${params.quantity} × ${item.productName} ${item.variantLabel} (${item.sku}) off order ${item.order.number}: they will not be sent. ${outstanding(item) - params.quantity} of that line would remain to send. No money is returned by this step; those units cost ${euros(item.unitPriceCents * params.quantity)} at list price, and a refund is a separate decision.`;
    },
    async execute(ctx, params) {
      const result = await cancelOutstanding(ctx, params.orderItemId, params.quantity);
      return `${params.quantity} × ${params.sku} taken off order ${params.orderNumber}. No money was returned; the units cost ${euros(result.valueCents)} at list price.`;
    },
    path: (params) => `/admin/orders/${params.orderId}`,
  }),
  stock_adjustment: kind({
    label: "Stock adjustment",
    level: "MANAGER",
    area: "inventory",
    params: stockParams,
    async describe(ctx, params) {
      const variant = await ctx.db.variant.findUnique({ where: { id: params.variantId }, include: { product: { select: { name: true } } } });
      if (!variant) throw new AppError("NOT_FOUND", "That size no longer exists.");
      if (params.delta === 0 || Math.abs(params.delta) > 100_000) throw new AppError("BAD_INPUT", "Enter a whole number other than zero.");
      if (variant.stock + params.delta < variant.reserved) throw new AppError("BAD_INPUT", "That would take stock below the units held by unpaid orders.");
      return `${params.delta > 0 ? `Add ${params.delta}` : `Remove ${-params.delta}`} unit(s) of ${variant.product.name} ${variant.label} (${variant.sku}): on hand ${variant.stock} → ${variant.stock + params.delta}. Recorded as ${params.reason.toLowerCase()}${params.note ? `, note: ${params.note}` : ""}.${params.delta > 0 ? " New stock goes first to paid orders waiting for it." : ""}`;
    },
    async execute(ctx, params) {
      await adjustStock(ctx, params.variantId, params.delta, params.reason, params.note ?? undefined);
      return `Stock of ${params.sku} changed by ${params.delta > 0 ? "+" : ""}${params.delta}.`;
    },
    path: () => "/admin/inventory",
  }),
  support_status: kind({
    label: "Support request state",
    level: "STAFF",
    area: "support",
    params: supportParams,
    async describe(ctx, params) {
      const request = await ctx.db.supportRequest.findUnique({ where: { id: params.requestId }, select: { subject: true, status: true, email: true } });
      if (!request) throw new AppError("NOT_FOUND", "Request not found.");
      return `Mark support request ${params.reference} ("${request.subject}", from ${request.email}) as ${params.status}; it is ${request.status} now.${params.note ? ` Note for colleagues: ${params.note}` : ""} Nothing is sent to the customer.`;
    },
    async execute(ctx, params) {
      await setSupportStatus(ctx, params.requestId, { status: params.status, staffNote: params.note ?? "" });
      return `Support request ${params.reference} marked ${params.status}.`;
    },
    path: () => "/admin/support",
  }),
} as const;
export type ProposalKind = keyof typeof PROPOSAL_KINDS;
const isKind = (value: string): value is ProposalKind => value in PROPOSAL_KINDS;

const canonical = (value: unknown) => JSON.stringify(Object.entries((value ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
const audit = (ctx: Ctx, action: string, proposal: AiProposal, data: object = {}) => ctx.db.auditLog.create({ data: { actorType: "admin", actorId: ctx.admin?.id ?? null, action, entity: "AiProposal", entityId: proposal.id, data: { reference: proposalReference(proposal.sequence), kind: proposal.kind, ...data }, ip: ctx.ip } });

/**
 * Records a suggestion. Refused outright when the person the assistant is
 * talking to could not do this themselves: the assistant is not a way round
 * a role.
 */
export async function createProposal(ctx: Ctx, conversationId: string, kindName: ProposalKind, input: unknown, now = new Date()): Promise<{ proposal: AiProposal; existing: boolean }> {
  const definition = PROPOSAL_KINDS[kindName];
  const admin = requireAdmin(ctx, definition.level, definition.area);
  const params = definition.params.parse(input);
  const summary = await definition.describe(ctx, params);
  // The same suggestion made twice in one conversation is one suggestion.
  const pending = await ctx.db.aiProposal.findMany({ where: { adminUserId: admin.id, status: "PENDING", expiresAt: { gt: now } } });
  // Compared key by key: the database does not keep the order of a JSON object's keys.
  const same = pending.find((row) => row.conversationId === conversationId && row.kind === kindName && canonical(row.params) === canonical(params));
  if (same) return { proposal: same, existing: true };
  if (pending.length >= MAX_PENDING) throw new AppError("BAD_INPUT", `There are already ${MAX_PENDING} proposals waiting for this person's decision. They must approve or reject some first.`);
  const proposal = await ctx.db.aiProposal.create({ data: { conversationId, adminUserId: admin.id, kind: kindName, params: params as Prisma.InputJsonValue, summary, expiresAt: new Date(now.getTime() + PROPOSAL_HOURS * 3_600_000) } });
  await audit(ctx, "assistant.proposal.create", proposal);
  return { proposal, existing: false };
}

export type ProposalView = { id: string; reference: string; kind: string; label: string; summary: string; status: string; result: string | null; createdAt: Date; decidedAt: Date | null; expiresAt: Date; path: string | null };
export function viewProposal(row: AiProposal, now = new Date()): ProposalView {
  const definition = isKind(row.kind) ? PROPOSAL_KINDS[row.kind] : null;
  const parsed = definition?.params.safeParse(row.params);
  return { id: row.id, reference: proposalReference(row.sequence), kind: row.kind, label: definition?.label ?? row.kind, summary: row.summary, status: row.status === "PENDING" && row.expiresAt <= now ? "EXPIRED" : row.status, result: row.result, createdAt: row.createdAt, decidedAt: row.decidedAt, expiresAt: row.expiresAt, path: definition && parsed?.success ? definition.path(parsed.data) : null };
}

/** The signed-in person's own proposals: those waiting, then the latest decided. */
export async function listMyProposals(ctx: Ctx, now = new Date()): Promise<{ waiting: ProposalView[]; decided: ProposalView[] }> {
  if (!ctx.admin) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  const rows = await ctx.db.aiProposal.findMany({ where: { adminUserId: ctx.admin.id }, orderBy: { createdAt: "desc" }, take: 60 });
  const views = rows.map((row) => viewProposal(row, now));
  return { waiting: views.filter((view) => view.status === "PENDING"), decided: views.filter((view) => view.status !== "PENDING").slice(0, 20) };
}

/**
 * A person's decision on a proposal the assistant made to them. Approval
 * runs the change, once, as that person. A proposal is checked again when it
 * is approved: what was true when it was written may not be any more, and
 * then it fails with the reason and nothing is changed.
 */
export async function decideProposal(ctx: Ctx, id: string, approve: boolean, now = new Date()): Promise<ProposalView> {
  if (!ctx.admin) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  const admin = ctx.admin;
  const proposal = await ctx.db.aiProposal.findFirst({ where: { id, adminUserId: admin.id } });
  if (!proposal) throw new AppError("NOT_FOUND", "Proposal not found.");
  if (proposal.status !== "PENDING") throw new AppError("BAD_INPUT", "This proposal has already been decided.");
  if (proposal.expiresAt <= now) {
    await ctx.db.aiProposal.updateMany({ where: { id, status: "PENDING" }, data: { status: "EXPIRED" } });
    throw new AppError("BAD_INPUT", `This proposal is more than ${PROPOSAL_HOURS} hours old and has expired. Ask the assistant again if it is still wanted.`);
  }
  if (!approve) {
    const done = await ctx.db.aiProposal.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedById: admin.id, decidedAt: now } });
    if (done.count !== 1) throw new AppError("BAD_INPUT", "This proposal has already been decided.");
    await audit(ctx, "assistant.proposal.reject", proposal);
    return viewProposal(await ctx.db.aiProposal.findUniqueOrThrow({ where: { id } }), now);
  }

  if (!isKind(proposal.kind)) throw new AppError("BAD_INPUT", "This kind of proposal can no longer be carried out.");
  const definition = PROPOSAL_KINDS[proposal.kind];
  // Checked before the proposal is claimed, so a person without the role leaves it untouched.
  requireAdmin(ctx, definition.level, definition.area);
  const params = definition.params.parse(proposal.params);
  // Claimed in one statement: two clicks, or two tabs, run it once.
  const claimed = await ctx.db.aiProposal.updateMany({ where: { id, status: "PENDING" }, data: { status: "EXECUTING", decidedById: admin.id, decidedAt: now } });
  if (claimed.count !== 1) throw new AppError("BAD_INPUT", "This proposal has already been decided.");
  let status: "EXECUTED" | "FAILED";
  let result: string;
  try {
    result = await definition.execute(ctx, params);
    status = "EXECUTED";
  } catch (error) {
    status = "FAILED";
    if (error instanceof AppError) result = `Not done: ${error.message}`;
    else {
      console.error("[assistant] proposal failed", proposal.id, error);
      result = "It stopped with an unexpected error. Check the record itself before trying again: part of it may have been done.";
    }
  }
  const updated = await ctx.db.aiProposal.update({ where: { id }, data: { status, result } });
  await audit(ctx, status === "EXECUTED" ? "assistant.proposal.execute" : "assistant.proposal.fail", proposal, { result });
  return viewProposal(updated, now);
}

/** Proposals nobody decided in time are closed, and one cut off mid-run is marked so, so the list of waiting ones stays true. */
export async function expireProposals(db: Ctx["db"], now = new Date()): Promise<number> {
  const expired = await db.aiProposal.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  const stuck = await db.aiProposal.updateMany({ where: { status: "EXECUTING", decidedAt: { lte: new Date(now.getTime() - 15 * 60_000) } }, data: { status: "FAILED", result: "It was interrupted while running. Check the record itself: part of it may have been done." } });
  return expired.count + stuck.count;
}
