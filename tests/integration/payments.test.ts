import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";
import { createServer } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";
import { releaseExpiredReservations } from "@/server/checkout";
import { applyPaymentEvent, createStripeProvider, setPaymentProvider, type PaymentProvider } from "@/server/payments";
import { code, createClient, db, resetDb, seedCatalog } from "../helpers";

const server = createServer(storefrontSchema);

// Not real credentials: signature verification is pure computation and needs no network.
const WEBHOOK_SECRET = "whsec_test_only_not_a_real_secret";
const stripeProvider = createStripeProvider("sk_test_not_a_real_key", WEBHOOK_SECRET);
const stripe = new Stripe("sk_test_not_a_real_key");

/** Stands in for Stripe's API when creating a payment page. */
const fakeProvider: PaymentProvider = {
  name: "STRIPE",
  createCheckout: async ({ order }) => ({ providerRef: `cs_test_${order.number}`, url: `https://pay.example/${order.number}` }),
  parseWebhook: stripeProvider.parseWebhook,
};

const ADDRESS = { firstName: "Test", lastName: "Customer", line1: "Teststraat 1", postalCode: "1000", city: "Brussels", countryCode: "BE" };
const PAY = `mutation ($n: String!, $t: String!) { startPayment(number: $n, token: $t) }`;

let rates: { standardRateId: string };

async function placeOrder(quantity = 2) {
  const c = createClient(server);
  await c.gql(`mutation ($q: Int!) { cartAdd(sku: "t-500", quantity: $q) { itemCount } }`, { q: quantity });
  const placed = await c.gql<{ checkout: { number: string; accessToken: string; totalCents: number } }>(
    `mutation ($input: CheckoutInput!) { checkout(input: $input) { number accessToken totalCents } }`,
    { input: { email: "guest@example.com", shippingRateId: rates.standardRateId, address: ADDRESS } },
  );
  if (!placed.data) throw new Error(JSON.stringify(placed.errors));
  return { c, ...placed.data.checkout };
}

function sessionEvent(type: string, session: Record<string, unknown>, id = `evt_${Math.random().toString(36).slice(2)}`) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object: { object: "checkout.session", payment_method_types: ["card"], ...session } } });
  return { payload, signature: stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) };
}

const paidSession = (number: string, amount: number, id?: string) => sessionEvent("checkout.session.completed", { id: `cs_test_${number}`, amount_total: amount, currency: "eur", payment_status: "paid" }, id);
const stockOf = async (sku: string) => {
  const v = await db.variant.findUniqueOrThrow({ where: { sku } });
  return [v.stock, v.reserved];
};

beforeEach(async () => {
  await resetDb();
  rates = await seedCatalog();
  setPaymentProvider(fakeProvider);
});

afterAll(() => setPaymentProvider(undefined));

describe("starting a payment", () => {
  it("says plainly when no provider is connected", async () => {
    setPaymentProvider(null);
    const { c, number, accessToken } = await placeOrder();
    expect((await c.gql<{ paymentAvailable: boolean }>(`{ paymentAvailable }`)).data?.paymentAvailable).toBe(false);
    expect(code(await c.gql(PAY, { n: number, t: accessToken }))).toBe("PAYMENT_UNAVAILABLE");
    expect(await db.payment.count()).toBe(0);
  });

  it("needs the order's private token and records the payment attempt for the exact total", async () => {
    const { c, number, accessToken, totalCents } = await placeOrder();
    expect(code(await c.gql(PAY, { n: number, t: "wrong-token" }))).toBe("NOT_FOUND");
    const started = await c.gql<{ startPayment: string }>(PAY, { n: number, t: accessToken });
    expect(started.data?.startPayment).toBe(`https://pay.example/${number}`);
    expect(await db.payment.findFirstOrThrow()).toMatchObject({ provider: "STRIPE", status: "UNPAID", amountCents: totalCents });
    expect((await db.order.findFirstOrThrow()).paymentStatus).toBe("UNPAID"); // starting to pay is not paying
  });

  it("lets a guest reopen their order only with the token", async () => {
    const { number, accessToken } = await placeOrder();
    const stranger = createClient(server);
    const query = `query ($n: String!, $t: String!) { orderByToken(number: $n, token: $t) { number paymentStatus accessToken } }`;
    expect((await stranger.gql<{ orderByToken: null }>(query, { n: number, t: "guess" })).data?.orderByToken).toBeNull();
    expect((await stranger.gql<{ orderByToken: { paymentStatus: string; accessToken: null } }>(query, { n: number, t: accessToken })).data?.orderByToken).toEqual({ number, paymentStatus: "UNPAID", accessToken: null });
  });
});

describe("Stripe webhook", () => {
  it("rejects unsigned and tampered requests without touching the order", async () => {
    const { c, number, accessToken, totalCents } = await placeOrder();
    await c.gql(PAY, { n: number, t: accessToken });
    setPaymentProvider(stripeProvider);
    const { payload, signature } = paidSession(number, totalCents);

    const unsigned = await stripeWebhook(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: payload }));
    const tampered = await stripeWebhook(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: payload.replace(String(totalCents), "1"), headers: { "stripe-signature": signature } }));
    expect([unsigned.status, tampered.status]).toEqual([400, 400]);
    expect((await db.order.findFirstOrThrow()).paymentStatus).toBe("UNPAID");
    expect(await db.webhookEvent.count()).toBe(0);
  });

  it("marks the order paid once, moves stock, and queues each notification exactly once", async () => {
    const { c, number, accessToken, totalCents } = await placeOrder(2);
    await c.gql(PAY, { n: number, t: accessToken });
    expect(await stockOf("t-500")).toEqual([10, 2]);
    setPaymentProvider(stripeProvider);

    const { payload, signature } = paidSession(number, totalCents, "evt_once");
    const deliver = () => stripeWebhook(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": signature } }));

    expect(await (await deliver()).json()).toEqual({ received: true, result: "paid" });
    expect(await db.order.findFirstOrThrow()).toMatchObject({ status: "PAID", paymentStatus: "PAID", reservedUntil: null });
    expect(await stockOf("t-500")).toEqual([8, 0]);
    expect(await db.inventoryMovement.findFirstOrThrow()).toMatchObject({ delta: -2, reason: "SALE" });
    expect((await db.outboxJob.findMany()).map((job) => job.kind).sort()).toEqual(["notify.customer.confirmation", "notify.owner.email", "notify.owner.sms", "notify.owner.whatsapp"]);

    // Stripe redelivers the same event, then sends a second event for the same payment.
    expect((await (await deliver()).json()).result).toBe("duplicate");
    const second = paidSession(number, totalCents, "evt_second");
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(second.payload, second.signature))).toBe("duplicate");
    expect(await stockOf("t-500")).toEqual([8, 0]);
    expect(await db.outboxJob.count()).toBe(4);
    expect(await db.inventoryMovement.count()).toBe(1);
  });

  it("accepts a payment the customer made in another currency through Adaptive Pricing", async () => {
    const { c, number, accessToken, totalCents } = await placeOrder();
    await c.gql(PAY, { n: number, t: accessToken });
    // The session reports what the customer paid (PLN); what we asked for (EUR) is in currency_conversion.
    const converted = { amount_subtotal: totalCents, amount_total: totalCents, fx_rate: "4.31", source_currency: "eur" };
    const { payload, signature } = sessionEvent("checkout.session.completed", { id: `cs_test_${number}`, amount_total: Math.round(totalCents * 4.31), currency: "pln", payment_status: "paid", currency_conversion: converted });
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(payload, signature))).toBe("paid");
    expect((await db.order.findFirstOrThrow()).paymentStatus).toBe("PAID");
  });

  it("refuses a converted payment whose original amount does not match the order", async () => {
    const { c, number, accessToken, totalCents } = await placeOrder();
    await c.gql(PAY, { n: number, t: accessToken });
    const converted = { amount_subtotal: totalCents - 100, amount_total: totalCents - 100, fx_rate: "4.31", source_currency: "eur" };
    const { payload, signature } = sessionEvent("checkout.session.completed", { id: `cs_test_${number}`, amount_total: Math.round(totalCents * 4.31), currency: "pln", payment_status: "paid", currency_conversion: converted });
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(payload, signature))).toBe("amount-mismatch");
  });

  it("refuses a payment whose amount does not match the order", async () => {
    const { c, number, accessToken, totalCents } = await placeOrder();
    await c.gql(PAY, { n: number, t: accessToken });
    const { payload, signature } = paidSession(number, totalCents - 100);
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(payload, signature))).toBe("amount-mismatch");
    expect((await db.order.findFirstOrThrow()).paymentStatus).toBe("UNPAID");
    expect(await db.auditLog.findFirstOrThrow()).toMatchObject({ action: "payment.amount_mismatch" });
    expect(await db.outboxJob.count()).toBe(0);
  });

  it("does not treat a completed session with a pending bank payment as paid", async () => {
    const { c, number, accessToken, totalCents } = await placeOrder();
    await c.gql(PAY, { n: number, t: accessToken });
    const pending = sessionEvent("checkout.session.completed", { id: `cs_test_${number}`, amount_total: totalCents, currency: "eur", payment_status: "unpaid" });
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(pending.payload, pending.signature))).toBe("processing");
    expect(await db.order.findFirstOrThrow()).toMatchObject({ paymentStatus: "PROCESSING", status: "PAYMENT_PROCESSING", paidAt: null });
    expect(await db.outboxJob.count()).toBe(0); // nobody is told an order is paid before it is

    // The held stock is not handed to someone else while the bank is still deciding.
    expect(await releaseExpiredReservations(db, new Date(Date.now() + 48 * 3600_000))).toBe(0);

    const settled = sessionEvent("checkout.session.async_payment_succeeded", { id: `cs_test_${number}`, amount_total: totalCents, currency: "eur", payment_status: "paid" });
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(settled.payload, settled.signature))).toBe("paid");
    expect(await db.order.findFirstOrThrow()).toMatchObject({ paymentStatus: "PAID", status: "PAID" });
    expect(await stockOf("t-500")).toEqual([8, 0]);
  });

  it("returns an order to pending payment when a delayed payment fails", async () => {
    const { c, number, accessToken, totalCents } = await placeOrder();
    await c.gql(PAY, { n: number, t: accessToken });
    const pending = sessionEvent("checkout.session.completed", { id: `cs_test_${number}`, amount_total: totalCents, currency: "eur", payment_status: "unpaid" });
    await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(pending.payload, pending.signature));
    const failed = sessionEvent("checkout.session.async_payment_failed", { id: `cs_test_${number}`, amount_total: totalCents, currency: "eur", payment_status: "unpaid" });
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(failed.payload, failed.signature))).toBe("failed");
    expect(await db.order.findFirstOrThrow()).toMatchObject({ paymentStatus: "FAILED", status: "PENDING_PAYMENT" });
    // Now that the payment is dead, the lapsed reservation is released like any other.
    expect(await releaseExpiredReservations(db, new Date(Date.now() + 48 * 3600_000))).toBe(1);
    expect(await stockOf("t-500")).toEqual([10, 0]);
  });

  it("ignores events for payments it never created, and unrelated event types", async () => {
    const stranger = paidSession("AZZ-9999", 100);
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(stranger.payload, stranger.signature))).toBe("unknown-payment");
    const other = sessionEvent("customer.created", { id: "cus_1" });
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(other.payload, other.signature))).toBe("ignored");
  });

  it("honours a payment that arrives after the reservation lapsed, and flags it if stock is gone", async () => {
    const { c, number, accessToken, totalCents } = await placeOrder(2);
    await c.gql(PAY, { n: number, t: accessToken });
    await releaseExpiredReservations(db, new Date(Date.now() + 60 * 60_000));
    expect(await stockOf("t-500")).toEqual([10, 0]);
    await db.variant.update({ where: { sku: "t-500" }, data: { stock: 1 } }); // someone else bought the rest

    const { payload, signature } = paidSession(number, totalCents);
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(payload, signature))).toBe("paid");
    expect(await db.order.findFirstOrThrow()).toMatchObject({ status: "PAID", paymentStatus: "PAID" });
    expect(await stockOf("t-500")).toEqual([1, 0]); // never driven negative
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "order.paid_without_stock" } })).toBeTruthy();
  });
});

describe("refunds and disputes made at the provider", () => {
  const signed = (type: string, object: Record<string, unknown>, created = 1_800_000_000, id = `evt_${Math.random().toString(36).slice(2)}`) => {
    const payload = JSON.stringify({ id, object: "event", type, created, data: { object } });
    return { payload, signature: stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) };
  };
  const post = async (event: { payload: string; signature: string }) => {
    const response = await stripeWebhook(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: event.payload, headers: { "stripe-signature": event.signature } }));
    return { status: response.status, result: ((await response.json()) as { result: string }).result };
  };
  const refundEvent = (type: string, refund: Record<string, unknown>) => signed(type, { object: "refund", payment_intent: "pi_1", currency: "eur", status: "succeeded", reason: null, ...refund });
  const disputeEvent = (type: string, dispute: Record<string, unknown>, created?: number) =>
    signed(type, { object: "dispute", id: "dp_1", payment_intent: "pi_1", currency: "eur", reason: "fraudulent", evidence_details: { due_by: 1_800_600_000 }, ...dispute }, created);

  /** An order paid through a checkout whose payment id is pi_1. */
  async function paidOrder(withIntent = true) {
    const { c, number, accessToken, totalCents } = await placeOrder(2);
    await c.gql(PAY, { n: number, t: accessToken });
    const paid = sessionEvent("checkout.session.completed", { id: `cs_test_${number}`, amount_total: totalCents, currency: "eur", payment_status: "paid", ...(withIntent ? { payment_intent: "pi_1" } : {}) });
    expect((await post(paid)).result).toBe("paid");
    await db.outboxJob.deleteMany();
    return { number, totalCents, order: await db.order.findFirstOrThrow() };
  }
  const state = async () => {
    const order = await db.order.findFirstOrThrow({ include: { payments: true } });
    return [order.status, order.paymentStatus, order.payments[0].status];
  };
  const jobs = async () => (await db.outboxJob.findMany({ orderBy: { createdAt: "asc" } })).map((job) => job.kind);

  it("remembers the provider's payment id when the order is paid", async () => {
    await paidOrder();
    expect((await db.payment.findFirstOrThrow()).intentRef).toBe("pi_1");
  });

  it("records a refund made in the provider's dashboard, once, and tells the customer", async () => {
    const { totalCents } = await paidOrder();
    const part = refundEvent("refund.created", { id: "re_a", amount: 1000, reason: "requested_by_customer" });
    expect(await post(part)).toEqual({ status: 200, result: "refund-recorded" });
    expect(await post(part)).toEqual({ status: 200, result: "duplicate" });
    // The same refund reported again under another event (refund.updated) changes nothing.
    expect((await post(refundEvent("refund.updated", { id: "re_a", amount: 1000 }))).result).toBe("refund-unchanged");

    expect(await db.refund.findMany()).toMatchObject([{ providerRef: "re_a", amountCents: 1000, adminUserId: null, reason: "requested by customer", failedAt: null }]);
    expect(await state()).toEqual(["PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED"]);
    expect(await jobs()).toEqual(["notify.customer.refund"]);
    expect(await stockOf("t-500")).toEqual([8, 0]); // stock is a staff decision, never automatic

    expect((await post(refundEvent("refund.created", { id: "re_b", amount: totalCents - 1000 }))).result).toBe("refund-recorded");
    expect(await state()).toEqual(["REFUNDED", "REFUNDED", "REFUNDED"]);
    expect((await db.orderEvent.findMany({ where: { kind: "refunded" }, orderBy: { createdAt: "asc" } })).map((event) => event.message)).toEqual(["Partial refund issued.", "Order refunded."]);
    expect(await db.auditLog.count({ where: { action: "refund.synced" } })).toBe(2);
  });

  it("keeps one row when staff and the provider report the same refund, in either order", async () => {
    await paidOrder();
    const payment = await db.payment.findFirstOrThrow();
    const boss = await db.adminUser.create({ data: { email: "boss@test.local", name: "Boss", role: "ADMINISTRATOR", passwordHash: "x" } });
    const { recordRefund } = await import("@/server/paymentSync");

    // Staff first, then the provider's webhook.
    await db.$transaction((tx) => recordRefund(tx, { paymentId: payment.id, providerRef: "re_staff", amountCents: 500, reason: "Dented cap", adminUserId: boss.id }));
    expect((await post(refundEvent("refund.created", { id: "re_staff", amount: 500 }))).result).toBe("refund-unchanged");
    // The webhook first, then the staff action finishing.
    expect((await post(refundEvent("refund.created", { id: "re_hook", amount: 300 }))).result).toBe("refund-recorded");
    const late = await db.$transaction((tx) => recordRefund(tx, { paymentId: payment.id, providerRef: "re_hook", amountCents: 300, reason: "Goodwill", adminUserId: boss.id }));
    expect(late.created).toBe(false);

    expect(await db.refund.findMany({ orderBy: { amountCents: "desc" } })).toMatchObject([
      { providerRef: "re_staff", amountCents: 500, adminUserId: boss.id, reason: "Dented cap" },
      { providerRef: "re_hook", amountCents: 300, adminUserId: boss.id, reason: "Goodwill" },
    ]);
    expect(await jobs()).toEqual(["notify.customer.refund"]); // only for the one the webhook recorded first
  });

  it("takes a refund back out of the books when the bank bounces it, and alerts the shop", async () => {
    await paidOrder();
    await post(refundEvent("refund.created", { id: "re_a", amount: 1000, status: "pending" }));
    expect(await state()).toEqual(["PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED"]);

    expect((await post(refundEvent("refund.failed", { id: "re_a", amount: 1000, status: "failed" }))).result).toBe("refund-failed");
    expect((await post(refundEvent("refund.updated", { id: "re_a", amount: 1000, status: "failed" }))).result).toBe("refund-unchanged");
    // A late "succeeded" for a refund already known to have failed does not revive it.
    expect((await post(refundEvent("refund.updated", { id: "re_a", amount: 1000 }))).result).toBe("refund-unchanged");

    expect((await db.refund.findFirstOrThrow()).failedAt).not.toBeNull();
    expect(await state()).toEqual(["PAID", "PAID", "PAID"]);
    expect(await jobs()).toEqual(["notify.customer.refund", "notify.owner.payment_alert"]);
    expect(await db.orderEvent.findFirstOrThrow({ where: { kind: "refund_failed" } })).toMatchObject({ isInternal: true });
  });

  it("does not book a refund in another currency, and asks a person to look", async () => {
    await paidOrder();
    expect((await post(refundEvent("refund.created", { id: "re_usd", amount: 1200, currency: "usd" }))).result).toBe("currency-mismatch");
    expect(await db.refund.count()).toBe(0);
    expect(await state()).toEqual(["PAID", "PAID", "PAID"]);
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "refund.currency_mismatch" } })).toBeTruthy();
    expect(await jobs()).toEqual(["notify.owner.payment_alert"]);
  });

  it("finds the order for a payment recorded before payment ids were stored", async () => {
    const { number } = await paidOrder(false);
    expect((await db.payment.findFirstOrThrow()).intentRef).toBeNull();
    const asked: string[] = [];
    setPaymentProvider({ ...fakeProvider, findCheckoutRef: async (intent) => (asked.push(intent), intent === "pi_1" ? `cs_test_${number}` : null) });

    expect((await post(refundEvent("refund.created", { id: "re_a", amount: 700 }))).result).toBe("refund-recorded");
    expect((await db.payment.findFirstOrThrow()).intentRef).toBe("pi_1");
    expect((await post(refundEvent("refund.created", { id: "re_b", amount: 100 }))).result).toBe("refund-recorded");
    expect(asked).toEqual(["pi_1"]); // asked once, then remembered

    // Money that never belonged to this shop is acknowledged and ignored.
    expect(await post(refundEvent("refund.created", { id: "re_x", amount: 100, payment_intent: "pi_other" }))).toEqual({ status: 200, result: "unknown-payment" });
    expect(await db.refund.count()).toBe(2);
  });

  it("mirrors a dispute from opening to loss, for staff only", async () => {
    const { totalCents, order } = await paidOrder();
    expect((await post(disputeEvent("charge.dispute.created", { amount: totalCents, status: "needs_response" }, 1_800_000_100))).result).toBe("dispute-opened");
    expect(await db.dispute.findFirstOrThrow()).toMatchObject({ providerRef: "dp_1", amountCents: totalCents, currency: "EUR", status: "needs_response", reason: "fraudulent", closedAt: null, evidenceDueAt: new Date(1_800_600_000_000) });
    expect(await state()).toEqual(["PAID", "PAID", "PAID"]); // a dispute is not a refund

    expect((await post(disputeEvent("charge.dispute.updated", { amount: totalCents, status: "under_review" }, 1_800_000_300))).result).toBe("dispute-updated");
    // An older event delivered late must not turn the clock back.
    expect((await post(disputeEvent("charge.dispute.updated", { amount: totalCents, status: "needs_response" }, 1_800_000_200))).result).toBe("dispute-stale");
    expect((await db.dispute.findFirstOrThrow()).status).toBe("under_review");

    expect((await post(disputeEvent("charge.dispute.closed", { amount: totalCents, status: "lost" }, 1_800_000_400))).result).toBe("dispute-closed");
    expect((await post(disputeEvent("charge.dispute.funds_withdrawn", { amount: totalCents, status: "needs_response" }, 1_800_000_500))).result).toBe("dispute-stale");
    expect(await db.dispute.findMany()).toMatchObject([{ status: "lost", closedAt: new Date(1_800_000_400_000) }]);

    expect(await jobs()).toEqual(["notify.owner.payment_alert", "notify.owner.payment_alert"]);
    const events = await db.orderEvent.findMany({ where: { orderId: order.id, kind: { startsWith: "dispute" } } });
    expect(events.map((event) => [event.kind, event.isInternal]).sort()).toEqual([["dispute_closed", true], ["dispute_opened", true]]);
    expect((await db.auditLog.findMany({ where: { action: { startsWith: "dispute." } } })).map((log) => log.action).sort()).toEqual(["dispute.closed", "dispute.opened"]);
  });

  it("sends the shop an alert email that names the order", async () => {
    const { totalCents, number } = await paidOrder();
    await db.setting.upsert({ where: { key: "notifications" }, create: { key: "notifications", value: { emailRecipient: "owner@test.local" } }, update: { value: { emailRecipient: "owner@test.local" } } });
    // Applied directly, so the job is still waiting: the webhook route would already have tried to send it.
    const opened = disputeEvent("charge.dispute.created", { amount: totalCents, status: "needs_response" });
    await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(opened.payload, opened.signature));
    const { processJobs } = await import("@/server/jobs");
    const bodies: string[] = [];
    const report = await processJobs(db, { env: { RESEND_API_KEY: "re_test_placeholder", EMAIL_FROM: "shop@test.local" }, transport: async (_url, init) => (bodies.push(init.body), { ok: true, status: 200, text: async () => "" }) });
    expect(report).toMatchObject({ claimed: 1, done: 1 });
    expect(JSON.parse(bodies[0])).toMatchObject({ to: ["owner@test.local"], subject: `A payment has been disputed: ${number}` });
  });
});
