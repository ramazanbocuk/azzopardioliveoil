import Stripe from "stripe";
import type { Order, PaymentProvider as ProviderName } from "@/generated/prisma/client";
import type { Ctx } from "./context";
import { hashToken } from "./crypto";
import type { Db } from "./db";
import { AppError } from "./errors";
import { enforce } from "./rateLimit";

/**
 * Payments.
 *
 * The browser is never trusted about money. It is sent to the provider's
 * hosted payment page; the order becomes PAID only when the provider calls
 * our webhook with a valid signature AND the amount matches the order.
 * A customer landing on the "thank you" page proves nothing and changes nothing.
 */

export type PaymentEvent = {
  eventId: string;
  type: string;
  outcome: "paid" | "failed" | "expired" | "ignored";
  providerRef: string;
  amountCents: number | null;
  currency: string | null;
  method: string | null;
};

export interface PaymentProvider {
  readonly name: ProviderName;
  /** Creates a hosted payment page for exactly the order total. */
  createCheckout(input: { order: Order; successUrl: string; cancelUrl: string; expiresAt: Date }): Promise<{ providerRef: string; url: string }>;
  /** Verifies the signature and translates the event. Throws if the signature is not valid. */
  parseWebhook(rawBody: string, signature: string | null): PaymentEvent;
  /** Returns money for a paid checkout. Resolves with the provider's refund id. */
  refund?(input: { providerRef: string; amountCents: number; idempotencyKey: string }): Promise<string>;
}

/** Stripe Checkout (hosted). Card data never touches this application. */
export function createStripeProvider(secretKey: string, webhookSecret: string): PaymentProvider {
  const stripe = new Stripe(secretKey);
  return {
    name: "STRIPE",

    async createCheckout({ order, successUrl, cancelUrl, expiresAt }) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          // Labels these sessions in the Stripe Dashboard so this checkout flow can be told apart from any later one.
          integration_identifier: "azzopardi-hosted-checkout-qhvxmrtk",
          // One line for the server-computed total, so Stripe can never charge a different amount than the order.
          line_items: [{ quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: order.totalCents, product_data: { name: `Azzopardi Olive Oil — order ${order.number}` } } }],
          customer_email: order.email,
          client_reference_id: order.id,
          metadata: { orderId: order.id, orderNumber: order.number ?? "" },
          success_url: successUrl,
          cancel_url: cancelUrl,
          expires_at: Math.floor(expiresAt.getTime() / 1000),
        },
        { idempotencyKey: `checkout:${order.id}:${order.updatedAt.getTime()}` },
      );
      if (!session.url) throw new Error("Stripe returned no checkout URL.");
      return { providerRef: session.id, url: session.url };
    },

    async refund({ providerRef, amountCents, idempotencyKey }) {
      const session = await stripe.checkout.sessions.retrieve(providerRef);
      const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (!paymentIntent) throw new Error("This checkout has no payment to refund.");
      const refund = await stripe.refunds.create({ payment_intent: paymentIntent, amount: amountCents }, { idempotencyKey });
      return refund.id;
    },

    parseWebhook(rawBody, signature) {
      if (!signature) throw new Error("Missing Stripe-Signature header.");
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      const base = { eventId: event.id, type: event.type };
      const none = { ...base, outcome: "ignored" as const, providerRef: "", amountCents: null, currency: null, method: null };

      if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded" && event.type !== "checkout.session.async_payment_failed" && event.type !== "checkout.session.expired") {
        return none;
      }
      const session = event.data.object;
      // With Adaptive Pricing a customer may pay in their own currency. The session then reports that
      // currency, and the amount we actually asked for sits in currency_conversion; compare against that.
      const asked = session.currency_conversion ? { amount: session.currency_conversion.amount_total, currency: session.currency_conversion.source_currency } : { amount: session.amount_total, currency: session.currency };
      const detail = { ...base, providerRef: session.id, amountCents: asked.amount, currency: asked.currency?.toUpperCase() ?? null, method: session.payment_method_types?.[0] ?? null };

      if (event.type === "checkout.session.expired") return { ...detail, outcome: "expired" };
      if (event.type === "checkout.session.async_payment_failed") return { ...detail, outcome: "failed" };
      // "completed" with a delayed method (e.g. bank transfer) is not money yet; wait for async_payment_succeeded.
      return { ...detail, outcome: session.payment_status === "paid" ? "paid" : "ignored" };
    },
  };
}

let override: PaymentProvider | null | undefined;
let cached: PaymentProvider | null | undefined;

/** Tests substitute a fake provider; production reads the environment. */
export function setPaymentProvider(provider: PaymentProvider | null | undefined) {
  override = provider;
}

/**
 * Stripe is the only provider implemented. Mollie is planned behind the same
 * interface and is NOT implemented: no code path pretends otherwise.
 */
export function getPaymentProvider(): PaymentProvider | null {
  if (override !== undefined) return override;
  if (cached === undefined) {
    const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = process.env;
    cached = STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET ? createStripeProvider(STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) : null;
  }
  return cached;
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Sends the customer to pay for an order they hold the private link to. */
export async function startPayment(ctx: Ctx, number: string, token: string): Promise<{ url: string }> {
  await enforce(ctx.db, `pay:ip:${ctx.ip}`, 20, 600);
  const order = await ctx.db.order.findUnique({ where: { number: number.trim().toUpperCase() } });
  if (!order || !order.accessTokenHash || order.accessTokenHash !== hashToken(token)) throw new AppError("NOT_FOUND", "Order not found.");
  if (order.paymentStatus === "PAID") throw new AppError("BAD_INPUT", "This order has already been paid.");
  if (order.status !== "PENDING_PAYMENT" || !order.reservedUntil || order.reservedUntil < new Date()) {
    throw new AppError("BAD_INPUT", "This order has expired. Please place it again.");
  }

  const provider = getPaymentProvider();
  if (!provider) throw new AppError("PAYMENT_UNAVAILABLE", "Online payment is not connected yet.");

  const link = `${appUrl()}/order-confirmation?order=${encodeURIComponent(order.number ?? "")}&token=${encodeURIComponent(token)}`;
  // Stripe requires at least 30 minutes; the stock reservation outlives the payment page.
  const expiresAt = new Date(Math.min(order.reservedUntil.getTime() - 60_000, Date.now() + 31 * 60_000));
  const checkout = await provider.createCheckout({ order, successUrl: link, cancelUrl: `${link}&cancelled=1`, expiresAt });

  await ctx.db.payment.create({ data: { orderId: order.id, provider: provider.name, providerRef: checkout.providerRef, amountCents: order.totalCents, currency: order.currency } });
  return { url: checkout.url };
}

export type WebhookResult = "paid" | "duplicate" | "ignored" | "unknown-payment" | "amount-mismatch" | "failed" | "expired";

/** Notifications owed for a paid order. Delivered with retries in Phase 7; each can exist only once. */
const PAID_JOBS = ["notify.owner.whatsapp", "notify.owner.email", "notify.owner.sms", "notify.customer.confirmation"] as const;

/**
 * Applies a verified provider event exactly once.
 * The unique (provider, eventId) row is the idempotency lock: a redelivered
 * webhook fails that insert and nothing else runs.
 */
export async function applyPaymentEvent(db: Db, provider: ProviderName, event: PaymentEvent): Promise<WebhookResult> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.webhookEvent.create({ data: { provider, eventId: event.eventId, type: event.type, processedAt: new Date() } });
      if (event.outcome === "ignored") return "ignored";

      const payment = await tx.payment.findUnique({ where: { provider_providerRef: { provider, providerRef: event.providerRef } }, include: { order: { include: { items: true } } } });
      if (!payment) return "unknown-payment";
      const { order } = payment;

      if (event.outcome === "failed" || event.outcome === "expired") {
        if (payment.status === "UNPAID") await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
        if (event.outcome === "failed") await tx.orderEvent.create({ data: { orderId: order.id, kind: "payment_failed", message: "Payment was not completed." } });
        return event.outcome;
      }

      // Never accept a payment for a different amount or currency than the order.
      if (event.amountCents !== order.totalCents || event.currency !== order.currency) {
        await tx.auditLog.create({ data: { actorType: "system", action: "payment.amount_mismatch", entity: "Order", entityId: order.id, data: { expected: order.totalCents, received: event.amountCents, currency: event.currency, providerRef: event.providerRef } } });
        return "amount-mismatch";
      }

      const claimed = await tx.order.updateMany({ where: { id: order.id, paymentStatus: { not: "PAID" } }, data: { status: "PAID", paymentStatus: "PAID", paidAt: new Date(), reservedUntil: null, cancelledAt: null } });
      if (claimed.count !== 1) return "duplicate"; // already paid through another event

      const wasReserved = order.status === "PENDING_PAYMENT";
      let short = false;
      for (const item of order.items) {
        if (!item.variantId) continue;
        const moved = wasReserved
          ? await tx.$executeRaw`UPDATE "Variant" SET "stock" = "stock" - ${item.quantity}, "reserved" = GREATEST("reserved" - ${item.quantity}, 0) WHERE "id" = ${item.variantId} AND "stock" >= ${item.quantity}`
          : // Paid after the reservation lapsed: take stock only if it is still there.
            await tx.$executeRaw`UPDATE "Variant" SET "stock" = "stock" - ${item.quantity} WHERE "id" = ${item.variantId} AND "stock" - "reserved" >= ${item.quantity}`;
        if (moved === 1) await tx.inventoryMovement.create({ data: { variantId: item.variantId, delta: -item.quantity, reason: "SALE", orderId: order.id } });
        else short = true;
      }

      await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID", method: event.method } });
      await tx.orderEvent.create({ data: { orderId: order.id, kind: "paid", message: "Payment received." } });
      if (short) {
        await tx.auditLog.create({ data: { actorType: "system", action: "order.paid_without_stock", entity: "Order", entityId: order.id, data: { note: "Paid after reservation expired and stock was no longer available. Needs manual review." } } });
      }
      await tx.outboxJob.createMany({ data: PAID_JOBS.map((kind) => ({ kind, dedupeKey: `${kind}:${order.id}`, payload: { orderId: order.id } })), skipDuplicates: true });
      return "paid";
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return "duplicate";
    throw error;
  }
}
