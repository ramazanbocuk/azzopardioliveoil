import { beforeEach, describe, expect, it } from "vitest";
import { GET as cron } from "@/app/api/cron/jobs/route";
import { MAX_ATTEMPTS, processJobs, requeueJob } from "@/server/jobs";
import { ChannelError, NotConfigured, sendEmail, sendSms, sendWhatsAppTemplate, type Transport } from "@/server/notifications/channels";
import { customerConfirmationEmail, newsletterConfirmEmail, ownerEmail, ownerText, ownerWhatsAppParameters, signLink, verifyLink } from "@/server/notifications/messages";
import { db, resetDb, seedCatalog, BILL } from "../helpers";

// Placeholder values: nothing here is a real credential and no request leaves the machine.
const ENV = {
  RESEND_API_KEY: "re_test_placeholder",
  EMAIL_FROM: "Azzopardi <orders@example.com>",
  WHATSAPP_ACCESS_TOKEN: "wa_test_placeholder",
  WHATSAPP_PHONE_NUMBER_ID: "1234567890",
  WHATSAPP_API_VERSION: "v0.0",
  WHATSAPP_TEMPLATE_NAME: "new_order",
  TWILIO_ACCOUNT_SID: "AC_test",
  TWILIO_AUTH_TOKEN: "tw_test_placeholder",
  TWILIO_FROM: "+15550000000",
};

type Call = { url: string; headers: Record<string, string>; body: string };

function recorder(status = 200) {
  const calls: Call[] = [];
  const transport: Transport = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return { ok: status >= 200 && status < 300, status, text: async () => "provider said no" };
  };
  return { calls, transport };
}

async function paidOrder() {
  const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
  const order = await db.order.create({
    data: {
      number: "AZZ-1001",
      email: "john@example.com",
      status: "PAID",
      paymentStatus: "PAID",
      subtotalCents: 8900,
      shippingCents: 0,
      totalCents: 8900,
      shippingRateName: "Standard",
      weightGrams: 3000,
      shipFirstName: "John",
      shipLastName: "Smith",
      shipLine1: "Rue Test 1",
      shipPostalCode: "1000",
      shipCity: "Brussels",
      shipCountryCode: "BE", ...BILL,
      items: {
        create: [
          { variantId: variant.id, sku: "t-500", productName: "Sicilian EVOO", variantLabel: "500ml", unitPriceCents: 2900, quantity: 2, lineTotalCents: 5800 },
          { sku: "t-750", productName: "Sicilian EVOO", variantLabel: "750ml", unitPriceCents: 3100, quantity: 1, lineTotalCents: 3100 },
        ],
      },
    },
    include: { items: true },
  });
  const kinds = ["notify.owner.whatsapp", "notify.owner.email", "notify.owner.sms", "notify.customer.confirmation"];
  await db.outboxJob.createMany({ data: kinds.map((kind) => ({ kind, dedupeKey: `${kind}:${order.id}`, payload: { orderId: order.id } })) });
  return order;
}

const settings = (value: Record<string, string | boolean>) => db.setting.upsert({ where: { key: "notifications" }, update: { value }, create: { key: "notifications", value } });
const statuses = async () => Object.fromEntries((await db.outboxJob.findMany()).map((job) => [job.kind, job.status]));

beforeEach(async () => {
  await resetDb();
  await seedCatalog();
});

describe("message content", () => {
  it("writes the owner alert in the agreed format", async () => {
    const order = await paidOrder();
    expect(ownerText(order).split("\n").slice(0, 8)).toEqual([
      "NEW ORDER RECEIVED",
      "Order: #AZZ-1001",
      "Customer: John Smith",
      "Products:",
      "- Sicilian EVOO 500ml x 2",
      "- Sicilian EVOO 750ml x 1",
      "Total: €89.00",
      "Shipping: Belgium",
    ]);
    expect(ownerText(order)).toContain("Payment: Paid");
    expect(ownerWhatsAppParameters(order)).toEqual(["#AZZ-1001", "John Smith", "Sicilian EVOO 500ml x 2; Sicilian EVOO 750ml x 1", "€89.00", "Belgium", "Paid"]);
  });

  it("escapes customer-supplied text in emails", async () => {
    const order = await paidOrder();
    const hostile = { ...order, shipFirstName: `<script>alert(1)</script>`, customerNote: `"><img src=x onerror=1>` };
    const html = ownerEmail(hostile, "owner@example.com").html + customerConfirmationEmail(hostile).html;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("signs links that cannot be reused for another address or purpose", () => {
    const secret = "x".repeat(32);
    const signature = signLink("newsletter-confirm", "abc", secret) ?? "";
    expect(verifyLink("newsletter-confirm", "abc", signature, secret)).toBe(true);
    expect(verifyLink("newsletter-confirm", "abd", signature, secret)).toBe(false);
    expect(verifyLink("newsletter-unsubscribe", "abc", signature, secret)).toBe(false);
    expect(verifyLink("newsletter-confirm", "abc", signature, "y".repeat(32))).toBe(false);
    expect(signLink("newsletter-confirm", "abc", "too-short")).toBeNull();
  });
});

describe("channels", () => {
  it("sends email through Resend with an idempotency key and the key in a header only", async () => {
    const { calls, transport } = recorder();
    await sendEmail({ to: "a@b.co", subject: "Hi", html: "<p>Hi</p>", text: "Hi" }, "job-1", ENV, transport);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].headers).toMatchObject({ authorization: "Bearer re_test_placeholder", "idempotency-key": "job-1" });
    expect(JSON.parse(calls[0].body)).toMatchObject({ from: ENV.EMAIL_FROM, to: ["a@b.co"], subject: "Hi" });
    expect(calls[0].body).not.toContain("re_test_placeholder");
  });

  it("sends WhatsApp as an approved template with clean parameters", async () => {
    const { calls, transport } = recorder();
    await sendWhatsAppTemplate("+32 470 12 34 56", ["#AZZ-1", "line one\nline two\ttabbed", ""], ENV, transport);
    expect(calls[0].url).toBe("https://graph.facebook.com/v0.0/1234567890/messages");
    expect(JSON.parse(calls[0].body)).toEqual({
      messaging_product: "whatsapp",
      to: "32470123456",
      type: "template",
      template: { name: "new_order", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "#AZZ-1" }, { type: "text", text: "line one line two tabbed" }, { type: "text", text: "-" }] }] },
    });
  });

  it("sends SMS through Twilio with basic authentication", async () => {
    const { calls, transport } = recorder();
    await sendSms("+32470123456", "Hello", ENV, transport);
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages.json");
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from("AC_test:tw_test_placeholder").toString("base64")}`);
    expect(new URLSearchParams(calls[0].body).get("Body")).toBe("Hello");
  });

  it("refuses to send without credentials, and tells retryable failures from permanent ones", async () => {
    const { transport } = recorder();
    await expect(sendEmail({ to: "a@b.co", subject: "", html: "", text: "" }, "k", {}, transport)).rejects.toBeInstanceOf(NotConfigured);
    await expect(sendWhatsAppTemplate("+32", [], { ...ENV, WHATSAPP_TEMPLATE_NAME: "" }, transport)).rejects.toBeInstanceOf(NotConfigured);
    await expect(sendSms("+32", "x", {}, transport)).rejects.toBeInstanceOf(NotConfigured);

    const failure = async (status: number) => sendSms("+32", "x", ENV, recorder(status).transport).catch((error: ChannelError) => error.retryable);
    expect([await failure(500), await failure(429), await failure(400), await failure(401)]).toEqual([true, true, false, false]);
    const offline: Transport = async () => Promise.reject(new Error("socket hang up"));
    expect(await sendSms("+32", "x", ENV, offline).catch((error: ChannelError) => error.retryable)).toBe(true);
  });
});

describe("job worker", () => {
  it("delivers each notification for a paid order once, on the channels that are switched on", async () => {
    await paidOrder();
    await settings({ emailRecipient: "owner@example.com", whatsappRecipient: "+32470123456", notifyByEmail: true, notifyByWhatsapp: true, notifyBySms: false });
    const { calls, transport } = recorder();

    expect(await processJobs(db, { env: ENV, transport })).toEqual({ claimed: 4, done: 3, skipped: 1, retried: 0, failed: 0 });
    expect(await statuses()).toEqual({ "notify.owner.whatsapp": "DONE", "notify.owner.email": "DONE", "notify.owner.sms": "SKIPPED", "notify.customer.confirmation": "DONE" });
    expect(calls.map((call) => new URL(call.url).host).sort()).toEqual(["api.resend.com", "api.resend.com", "graph.facebook.com"]);
    expect(calls.filter((call) => call.url.includes("resend")).map((call) => JSON.parse(call.body).to[0]).sort()).toEqual(["john@example.com", "owner@example.com"]);

    expect((await processJobs(db, { env: ENV, transport })).claimed).toBe(0); // nothing is ever sent twice
    expect(calls).toHaveLength(3);
  });

  it("never lets two workers send the same job", async () => {
    await paidOrder();
    await settings({ emailRecipient: "owner@example.com", whatsappRecipient: "+32470123456", smsRecipient: "+32470123456", notifyBySms: true });
    const { calls, transport } = recorder();
    const reports = await Promise.all([processJobs(db, { env: ENV, transport }), processJobs(db, { env: ENV, transport }), processJobs(db, { env: ENV, transport })]);
    expect(reports.reduce((sum, report) => sum + report.claimed, 0)).toBe(4);
    expect(calls).toHaveLength(4);
  });

  it("records a channel with no credentials as skipped, not sent, and can retry it later", async () => {
    await paidOrder();
    await settings({ emailRecipient: "owner@example.com", whatsappRecipient: "+32470123456" });
    const { calls, transport } = recorder();
    expect(await processJobs(db, { env: {}, transport })).toMatchObject({ done: 0, skipped: 4 });
    expect(calls).toHaveLength(0);
    const job = await db.outboxJob.findFirstOrThrow({ where: { kind: "notify.owner.email" } });
    expect(job.lastError).toMatch(/not configured/);

    await requeueJob(db, job.id); // the owner connects email, then presses Retry
    expect(await processJobs(db, { env: ENV, transport })).toMatchObject({ claimed: 1, done: 1 });
  });

  it("retries with growing delays and gives up visibly after the last attempt", async () => {
    await paidOrder();
    await db.outboxJob.deleteMany({ where: { kind: { not: "notify.customer.confirmation" } } });
    const { transport } = recorder(503);
    const start = new Date(Math.ceil(Date.now() / 1000) * 1000 + 5000); // just after the job was queued

    expect(await processJobs(db, { env: ENV, transport, now: start })).toMatchObject({ retried: 1 });
    let job = await db.outboxJob.findFirstOrThrow();
    expect([job.status, job.attempts, job.runAfter.getTime()]).toEqual(["PENDING", 1, start.getTime() + 60_000]); // first retry after one minute
    expect((await processJobs(db, { env: ENV, transport, now: start })).claimed).toBe(0); // not due yet

    let now = start;
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
      now = new Date((await db.outboxJob.findFirstOrThrow()).runAfter.getTime() + 1000);
      await processJobs(db, { env: ENV, transport, now });
    }
    job = await db.outboxJob.findFirstOrThrow();
    expect([job.status, job.attempts]).toEqual(["FAILED", MAX_ATTEMPTS]);
    expect(job.lastError).toMatch(/HTTP 503/);
  });

  it("fails at once when the provider rejects the message itself", async () => {
    await paidOrder();
    await db.outboxJob.deleteMany({ where: { kind: { not: "notify.customer.confirmation" } } });
    expect(await processJobs(db, { env: ENV, transport: recorder(422).transport })).toMatchObject({ failed: 1, retried: 0 });
  });

  it("recovers jobs left locked by a worker that died", async () => {
    await paidOrder();
    await db.outboxJob.updateMany({ data: { status: "PROCESSING", lockedAt: new Date(Date.now() - 11 * 60_000) } });
    await settings({ emailRecipient: "owner@example.com" });
    expect((await processJobs(db, { env: ENV, transport: recorder().transport })).claimed).toBe(4);
  });

  it("sends a signed confirmation link for the newsletter, only while the address is pending", async () => {
    process.env.APP_SECRET = "s".repeat(40);
    const subscriber = await db.newsletterSubscriber.create({ data: { email: "reader@example.com", tokenHash: "h" } });
    await db.outboxJob.create({ data: { kind: "email.newsletter.confirm", dedupeKey: "n1", payload: { subscriberId: subscriber.id } } });
    const { calls, transport } = recorder();
    expect(await processJobs(db, { env: ENV, transport })).toMatchObject({ done: 1 });
    const text = JSON.parse(calls[0].body).text as string;
    const link = new URL(text.split("\n")[1]);
    expect(verifyLink("newsletter-confirm", link.searchParams.get("id") ?? "", link.searchParams.get("sig") ?? "")).toBe(true);
    expect(newsletterConfirmEmail(subscriber)?.to).toBe("reader@example.com");

    await db.newsletterSubscriber.update({ where: { id: subscriber.id }, data: { status: "SUBSCRIBED" } });
    await db.outboxJob.create({ data: { kind: "email.newsletter.confirm", dedupeKey: "n2", payload: { subscriberId: subscriber.id } } });
    expect(await processJobs(db, { env: ENV, transport })).toMatchObject({ skipped: 1 });
    delete process.env.APP_SECRET;
  });
});

describe("scheduler endpoint", () => {
  it("does nothing without the right secret", async () => {
    delete process.env.CRON_SECRET;
    expect((await cron(new Request("http://localhost/api/cron/jobs", { headers: { authorization: "Bearer " } }))).status).toBe(401);
    process.env.CRON_SECRET = "c".repeat(32);
    expect((await cron(new Request("http://localhost/api/cron/jobs"))).status).toBe(401);
    expect((await cron(new Request("http://localhost/api/cron/jobs", { headers: { authorization: `Bearer ${"d".repeat(32)}` } }))).status).toBe(401);
    const ok = await cron(new Request("http://localhost/api/cron/jobs", { headers: { authorization: `Bearer ${"c".repeat(32)}` } }));
    expect(await ok.json()).toMatchObject({ releasedOrders: 0, jobs: { claimed: 0, done: 0, skipped: 0, retried: 0, failed: 0 }, purged: { sessions: 0 } });
    delete process.env.CRON_SECRET;
  });
});
