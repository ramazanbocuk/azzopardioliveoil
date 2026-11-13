import type { PaymentProvider as ProviderName, PaymentStatus } from "@/generated/prisma/client";
import type { Db, Tx } from "./db";
import { syncOrderStatus } from "./orderStatus";

/**
 * Refunds and disputes that happen at the payment provider.
 *
 * Staff can refund from the order page, but money can also move without this
 * application: a refund made in the Stripe Dashboard, a refund the bank later
 * bounces, a cardholder disputing a charge. The provider tells us through
 * signed webhooks; this file mirrors what it says so the admin panel and the
 * reports agree with the provider's books.
 *
 * Nothing here moves money. It only records what the provider reports.
 */

export type RefundEvent = {
  eventId: string;
  type: string;
  outcome: "refund";
  /** The provider's id for the payment the refund belongs to (Stripe PaymentIntent). */
  intentRef: string;
  refundRef: string;
  amountCents: number;
  currency: string;
  /** "failed" when the money did not reach the customer (refused by the bank, or cancelled). */
  state: "ok" | "failed";
  reason: string | null;
};

export type DisputeEvent = {
  eventId: string;
  type: string;
  outcome: "dispute";
  intentRef: string;
  disputeRef: string;
  amountCents: number;
  currency: string;
  reason: string | null;
  status: string;
  evidenceDueAt: Date | null;
  /** When the provider produced the event; used to drop events that arrive out of order. */
  at: Date;
};

export type SyncResult = "refund-recorded" | "refund-updated" | "refund-failed" | "refund-unchanged" | "dispute-opened" | "dispute-updated" | "dispute-closed" | "dispute-stale" | "unknown-payment" | "currency-mismatch";

/** Stripe's status words for a dispute that is finished. */
const CLOSED_DISPUTE = new Set(["won", "lost", "warning_closed"]);
export const isClosedDispute = (status: string) => CLOSED_DISPUTE.has(status);

/** Plain words for the provider's dispute statuses. An unknown status is shown as the provider wrote it. */
export const DISPUTE_LABEL: Record<string, string> = {
  warning_needs_response: "Bank enquiry, needs an answer",
  warning_under_review: "Bank enquiry, under review",
  warning_closed: "Bank enquiry closed",
  needs_response: "Needs an answer",
  under_review: "Under review by the bank",
  won: "Won",
  lost: "Lost",
};

const systemAudit = (tx: Tx, action: string, entity: string, entityId: string, data: object) => tx.auditLog.create({ data: { actorType: "system", action, entity, entityId, data } });

/**
 * Writes one refund and brings the payment and the order into line with the
 * sum of all refunds that stand. Used both when staff refund from the admin
 * panel and when the provider reports a refund, so a refund reported by both
 * (the usual case for a staff refund) is still exactly one row.
 *
 * The payment row is locked first: the staff action and the provider's
 * webhook for the same refund then run one after the other, never interleaved.
 */
export async function recordRefund(
  tx: Tx,
  input: { paymentId: string; providerRef: string; amountCents: number; reason: string | null; adminUserId: string | null; failed?: boolean },
): Promise<{ created: boolean; changed: boolean; full: boolean; orderId: string; status: PaymentStatus }> {
  await tx.$queryRaw`SELECT 1 FROM "Payment" WHERE "id" = ${input.paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
  const existing = await tx.refund.findUnique({ where: { providerRef: input.providerRef } });
  const failed = input.failed === true;

  let created = false;
  let changed = false;
  if (!existing) {
    await tx.refund.create({ data: { paymentId: payment.id, providerRef: input.providerRef, amountCents: input.amountCents, reason: input.reason, adminUserId: input.adminUserId, failedAt: failed ? new Date() : null } });
    created = true;
    changed = true;
  } else {
    // A failure is final. Otherwise keep what staff wrote and only fill in what was missing.
    const becameFailed = failed && existing.failedAt === null;
    const adminUserId = existing.adminUserId ?? input.adminUserId;
    const reason = input.adminUserId ? (input.reason ?? existing.reason) : (existing.reason ?? input.reason);
    if (becameFailed || adminUserId !== existing.adminUserId || reason !== existing.reason) {
      await tx.refund.update({ where: { id: existing.id }, data: { adminUserId, reason, ...(becameFailed ? { failedAt: new Date() } : {}) } });
    }
    changed = becameFailed;
  }

  const standing = await tx.refund.aggregate({ where: { paymentId: payment.id, failedAt: null }, _sum: { amountCents: true } });
  const refunded = standing._sum.amountCents ?? 0;
  const status: PaymentStatus = refunded >= payment.amountCents ? "REFUNDED" : refunded > 0 ? "PARTIALLY_REFUNDED" : "PAID";
  // Only a payment that was received can be refunded; anything else is left alone.
  if (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status) && status !== payment.status) {
    await tx.payment.update({ where: { id: payment.id }, data: { status } });
    await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: status } });
    await syncOrderStatus(tx, payment.orderId);
  }
  return { created, changed, full: status === "REFUNDED", orderId: payment.orderId, status };
}

const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`;

async function findPayment(tx: Tx, provider: ProviderName, intentRef: string) {
  return tx.payment.findFirst({ where: { provider, intentRef }, orderBy: { createdAt: "desc" } });
}

export async function applyRefundEvent(tx: Tx, provider: ProviderName, event: RefundEvent): Promise<SyncResult> {
  const payment = await findPayment(tx, provider, event.intentRef);
  if (!payment) return "unknown-payment";

  // A payment taken in another currency (Stripe's Adaptive Pricing) is refunded in that currency.
  // Its amount cannot be booked against a euro order without guessing an exchange rate, so a person must look.
  if (event.currency !== payment.currency) {
    await systemAudit(tx, "refund.currency_mismatch", "Order", payment.orderId, { refundRef: event.refundRef, amountCents: event.amountCents, currency: event.currency, expected: payment.currency });
    await tx.orderEvent.create({ data: { orderId: payment.orderId, kind: "refund_needs_review", isInternal: true, message: `The payment provider reports a refund of ${money(event.amountCents, event.currency)} (${event.refundRef}). It is in another currency than the order, so it was not recorded. Check it at the provider.` } });
    await tx.outboxJob.createMany({ data: [{ kind: "notify.owner.payment_alert", dedupeKey: `notify.owner.payment_alert:refund-currency:${event.refundRef}`, payload: { orderId: payment.orderId, subject: "A refund needs checking", lines: [`The payment provider reports a refund of ${money(event.amountCents, event.currency)} (${event.refundRef}).`, "It is in another currency than the order, so the order was not updated. Check the refund at the provider."] } }], skipDuplicates: true });
    return "currency-mismatch";
  }

  const failed = event.state === "failed";
  const result = await recordRefund(tx, { paymentId: payment.id, providerRef: event.refundRef, amountCents: event.amountCents, reason: event.reason, adminUserId: null, failed });

  if (failed) {
    if (!result.changed) return "refund-unchanged";
    await systemAudit(tx, "refund.failed", "Order", result.orderId, { refundRef: event.refundRef, amountCents: event.amountCents });
    await tx.orderEvent.create({ data: { orderId: result.orderId, kind: "refund_failed", isInternal: true, message: `The refund of ${money(event.amountCents, event.currency)} did not reach the customer (${event.refundRef}). The money is back in the provider balance; the customer has not been refunded.` } });
    await tx.outboxJob.createMany({ data: [{ kind: "notify.owner.payment_alert", dedupeKey: `notify.owner.payment_alert:refund-failed:${event.refundRef}`, payload: { orderId: result.orderId, subject: "A refund did not go through", lines: [`The refund of ${money(event.amountCents, event.currency)} did not reach the customer (${event.refundRef}).`, "The customer has not been refunded. Arrange the refund another way, then note it on the order."] } }], skipDuplicates: true });
    return "refund-failed";
  }

  if (!result.created) return "refund-unchanged"; // staff issued it here and already recorded it
  await systemAudit(tx, "refund.synced", "Order", result.orderId, { refundRef: event.refundRef, amountCents: event.amountCents, reason: event.reason });
  await tx.orderEvent.create({ data: { orderId: result.orderId, kind: "refunded", message: result.full ? "Order refunded." : "Partial refund issued." } });
  await tx.outboxJob.createMany({ data: [{ kind: "notify.customer.refund", dedupeKey: `notify.customer.refund:${event.refundRef}`, payload: { orderId: result.orderId, amountCents: event.amountCents, full: result.full } }], skipDuplicates: true });
  return "refund-recorded";
}

export async function applyDisputeEvent(tx: Tx, provider: ProviderName, event: DisputeEvent): Promise<SyncResult> {
  const payment = await findPayment(tx, provider, event.intentRef);
  if (!payment) return "unknown-payment";
  await tx.$queryRaw`SELECT 1 FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE`;

  const closed = isClosedDispute(event.status);
  const fields = { amountCents: event.amountCents, currency: event.currency, reason: event.reason, status: event.status, evidenceDueAt: event.evidenceDueAt, providerAt: event.at, closedAt: closed ? event.at : null };
  const existing = await tx.dispute.findUnique({ where: { providerRef: event.disputeRef } });
  // Events can arrive late or twice in a different order; the newest one the provider produced wins.
  if (existing && (existing.providerAt > event.at || isClosedDispute(existing.status))) return "dispute-stale";

  if (existing) await tx.dispute.update({ where: { id: existing.id }, data: fields });
  else await tx.dispute.create({ data: { paymentId: payment.id, providerRef: event.disputeRef, ...fields } });

  const amount = money(event.amountCents, event.currency);
  const alert = async (key: string, subject: string, lines: string[]) =>
    tx.outboxJob.createMany({ data: [{ kind: "notify.owner.payment_alert", dedupeKey: `notify.owner.payment_alert:dispute:${event.disputeRef}:${key}`, payload: { orderId: payment.orderId, subject, lines } }], skipDuplicates: true });

  if (!existing) {
    const due = event.evidenceDueAt ? ` Answer it at the payment provider by ${event.evidenceDueAt.toISOString().slice(0, 10)}.` : " Answer it at the payment provider.";
    await systemAudit(tx, "dispute.opened", "Order", payment.orderId, { disputeRef: event.disputeRef, amountCents: event.amountCents, reason: event.reason, status: event.status });
    await tx.orderEvent.create({ data: { orderId: payment.orderId, kind: "dispute_opened", isInternal: true, message: `The cardholder disputed ${amount} with their bank${event.reason ? ` (reason given: ${event.reason.replaceAll("_", " ")})` : ""}.${closed ? "" : due}` } });
    if (!closed) await alert("opened", "A payment has been disputed", [`A cardholder disputed ${amount} with their bank${event.reason ? ` (reason given: ${event.reason.replaceAll("_", " ")})` : ""}.`, `${due.trim()} If nothing is submitted in time, the bank decides for the cardholder.`, "Do not ship this order until you have looked at it."]);
    if (!closed) return "dispute-opened";
  }

  if (closed && (!existing || !isClosedDispute(existing.status))) {
    const outcome = event.status === "won" ? `The dispute over ${amount} was decided in the shop's favour. The money stays.` : event.status === "lost" ? `The dispute over ${amount} was lost. The bank returned the money to the cardholder.` : `The bank's enquiry about ${amount} was closed without a chargeback.`;
    await systemAudit(tx, "dispute.closed", "Order", payment.orderId, { disputeRef: event.disputeRef, status: event.status, amountCents: event.amountCents });
    await tx.orderEvent.create({ data: { orderId: payment.orderId, kind: "dispute_closed", isInternal: true, message: outcome } });
    await alert("closed", event.status === "lost" ? "A dispute was lost" : "A dispute was closed", [outcome]);
    return "dispute-closed";
  }
  return "dispute-updated";
}

/**
 * Payments taken before the intent reference was stored know only their
 * checkout id. Before a refund or dispute event is applied, ask the provider
 * which checkout the money belongs to and remember the answer.
 */
export async function linkIntent(db: Db, provider: { name: ProviderName; findCheckoutRef?(intentRef: string): Promise<string | null> }, intentRef: string): Promise<void> {
  if (await db.payment.findFirst({ where: { provider: provider.name, intentRef }, select: { id: true } })) return;
  const checkoutRef = await provider.findCheckoutRef?.(intentRef);
  if (!checkoutRef) return;
  await db.payment.updateMany({ where: { provider: provider.name, providerRef: checkoutRef, intentRef: null }, data: { intentRef } });
}
