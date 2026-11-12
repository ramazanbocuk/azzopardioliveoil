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
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(pending.payload, pending.signature))).toBe("ignored");
    expect((await db.order.findFirstOrThrow()).paymentStatus).toBe("UNPAID");

    const settled = sessionEvent("checkout.session.async_payment_succeeded", { id: `cs_test_${number}`, amount_total: totalCents, currency: "eur", payment_status: "paid" });
    expect(await applyPaymentEvent(db, "STRIPE", stripeProvider.parseWebhook(settled.payload, settled.signature))).toBe("paid");
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
