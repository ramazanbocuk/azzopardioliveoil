import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as assistantRoute } from "@/app/api/assistant/route";
import { saveBatch } from "@/server/admin";
import { LIMITS, customerAssistantState, customerMessage, purgeOldConversations, rateConversation } from "@/server/ai/assistant";
import { CUSTOMER_INSTRUCTIONS } from "@/server/ai/prompt";
import { AssistantUnavailable, costMicros, setModelProvider, type ContentBlock, type ModelProvider, type ModelRequest, type ModelTurn } from "@/server/ai/provider";
import { assistantOverview, getConversation, listSupportRequests, saveArticle, saveAssistantSettings, setSupportStatus } from "@/server/assistantAdmin";
import type { Ctx } from "@/server/context";
import { processJobs } from "@/server/jobs";
import { eraseCustomerData, exportCustomerData } from "@/server/privacy";
import { addBatchDocument, addLabResult, setDocumentVerified, setLabResultVerified } from "@/server/provenance";
import { BILL, createAdmin, db, resetDb, seedCatalog } from "../helpers";

/**
 * The model is replaced by a script. These tests prove what the application
 * does around the model: what it lets the model see, what it refuses, what it
 * stores and what it spends. They cannot prove how a real model words an
 * answer; that needs the real model and is not tested here.
 */

const USAGE = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
const say = (text: string): ModelTurn => ({ content: [{ type: "text", text, citations: null }] as ContentBlock[], stopReason: "end_turn", model: "claude-opus-5-5", usage: USAGE });
const use = (...calls: [name: string, input: object][]): ModelTurn => ({ content: calls.map(([name, input], index) => ({ type: "tool_use", id: `toolu_${name}_${index}_${Math.random().toString(36).slice(2, 8)}`, name, input })) as ContentBlock[], stopReason: "tool_use", model: "claude-opus-5-5", usage: USAGE });

/** A provider that plays the given turns in order and remembers every request it was sent. */
function script(...turns: (ModelTurn | Error)[]) {
  const requests: ModelRequest[] = [];
  const provider: ModelProvider = {
    name: "script",
    model: "claude-opus-5-5",
    async complete(request) {
      requests.push(structuredClone(request));
      const next = turns.shift();
      if (!next) throw new Error("the script has no more turns");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  setModelProvider(provider);
  /** What the tools answered, as the model received it on its next call. */
  const results = (requestIndex: number) => {
    const last = requests[requestIndex].messages.at(-1)!;
    return (last.content as { type: string; content: string; is_error?: boolean }[]).map((block) => ({ ...JSON.parse(block.content), isError: block.is_error === true }));
  };
  return { requests, results };
}

const guest = (locale: Ctx["locale"] = "en", ip = `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`): Ctx => ({ db, ip, userAgent: "test", cookies: {}, setCookies: [], customer: null, admin: null, locale });
async function staff(role: "ADMINISTRATOR" | "MANAGER" | "STAFF"): Promise<Ctx> {
  const { email } = await createAdmin(role);
  return { db, ip: "10.9.9.9", userAgent: null, cookies: {}, setCookies: [], customer: null, admin: await db.adminUser.findUniqueOrThrow({ where: { email } }) };
}
const refused = async (promise: Promise<unknown>, expected: string) => expect(await promise.then(() => "resolved", (error: { code?: string }) => error.code)).toBe(expected);
const switchOn = (budgetCents = 5000, extraInstructions: string | null = null) => db.setting.upsert({ where: { key: "assistant" }, create: { key: "assistant", value: { customerEnabled: true, monthlyBudgetCents: budgetCents, extraInstructions } }, update: { value: { customerEnabled: true, monthlyBudgetCents: budgetCents, extraInstructions } } });

let productId: string;

beforeEach(async () => {
  await resetDb();
  productId = (await seedCatalog()).product.id;
  await switchOn();
});
afterAll(() => setModelProvider(undefined));

describe("whether the assistant answers at all", () => {
  it("stays silent until it is connected, switched on and given a budget, and stops when the budget is spent", async () => {
    setModelProvider(null);
    expect(await customerAssistantState(db)).toMatchObject({ available: false, reason: "not_connected" });
    expect(await customerMessage(guest(), { message: "Hello" })).toMatchObject({ status: "unavailable", text: "" });

    script({ ...say("Hello!"), usage: { ...USAGE, outputTokens: 1000 } });
    await db.setting.update({ where: { key: "assistant" }, data: { value: { customerEnabled: false, monthlyBudgetCents: 5000 } } });
    expect((await customerAssistantState(db)).reason).toBe("switched_off");
    await db.setting.update({ where: { key: "assistant" }, data: { value: { customerEnabled: true, monthlyBudgetCents: 0 } } });
    expect((await customerAssistantState(db)).reason).toBe("no_budget");

    // A budget of one cent: the first answer costs more than that, so it is also the last.
    await switchOn(1);
    expect(await customerMessage(guest(), { message: "Hello" })).toMatchObject({ status: "ok", text: "Hello!" });
    expect(await customerAssistantState(db)).toMatchObject({ available: false, reason: "budget_spent" });
    expect(await customerMessage(guest(), { message: "Are you there?" })).toMatchObject({ status: "unavailable" });
    expect(await db.aiMessage.count({ where: { role: "user" } })).toBe(1); // the second message was not even stored: nothing was spent on it
    expect(await db.outboxJob.count({ where: { kind: "notify.owner.notice" } })).toBe(1); // the shop is told once

    // Last month's spending does not count against this month.
    await db.aiMessage.updateMany({ data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    expect((await customerAssistantState(db)).available).toBe(true);
  });

  it("is switched on only by an administrator, and never without a budget", async () => {
    const [boss, manager] = [await staff("ADMINISTRATOR"), await staff("MANAGER")];
    await refused(saveAssistantSettings(manager, { customerEnabled: true, monthlyBudgetDollars: "50" }), "FORBIDDEN");
    await refused(saveAssistantSettings(boss, { customerEnabled: true, monthlyBudgetDollars: "" }), "BAD_INPUT");
    await refused(saveAssistantSettings(boss, { customerEnabled: true, monthlyBudgetDollars: "lots" }), "BAD_INPUT");
    await saveAssistantSettings(boss, { customerEnabled: true, monthlyBudgetDollars: "49,50", extraInstructions: "We are closed on 25 December." });
    expect((await db.setting.findUniqueOrThrow({ where: { key: "assistant" } })).value).toEqual({ customerEnabled: true, staffEnabled: false, monthlyBudgetCents: 4950, extraInstructions: "We are closed on 25 December." });
    expect(costMicros("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(24_000_000); // $4 in, $20 out
    expect(costMicros("a-model-not-in-the-table", USAGE)).toBeGreaterThan(costMicros("claude-opus-5-5", USAGE)); // unknown models are costed high, never low
  });
});

describe("laboratory values (acceptance test 3)", () => {
  it("gives the model the verified values of the right product and lot, and tells it to say so when there are none", async () => {
    const [manager, worker] = [await staff("MANAGER"), await staff("STAFF")];
    const batch = await saveBatch(manager, null, { lotNumber: "AZ-0007", productId, harvestYear: "2026", isPublished: true });
    const documentId = await addBatchDocument(worker, batch.id, { data: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"), title: "Analysis report", kind: "ANALYSIS" });
    await setDocumentVerified(manager, documentId, true);
    await setLabResultVerified(manager, await addLabResult(worker, batch.id, { measure: "polyphenols", value: "612", method: "HPLC (IOC)", laboratory: "Example Lab", testedAt: "2026-03-02", documentId }), true);
    await addLabResult(worker, batch.id, { measure: "free_acidity", value: "0.21", laboratory: "Example Lab", testedAt: "2026-03-02", documentId }); // entered, NOT verified

    const { requests, results } = script(use(["get_product", { slug: "evoo" }], ["get_product", { slug: "hidden" }], ["get_product", { slug: "no-such-oil" }]), say("Lot AZ-0007 of Test Oil was measured at 612 mg/kg total polyphenols."));
    const reply = await customerMessage(guest(), { message: "What is the polyphenol content of Test Oil?" });
    expect(reply).toMatchObject({ status: "ok", text: "Lot AZ-0007 of Test Oil was measured at 612 mg/kg total polyphenols." });

    const [verified, hidden, missing] = results(1);
    // The product with a verified result: exactly that value, with its lot, method, laboratory and report.
    expect(verified.currentLot).toMatchObject({ lotNumber: "AZ-0007", harvestYear: 2026 });
    expect(verified.laboratoryResults).toEqual([{ measure: "Total polyphenols", value: "612 mg/kg", method: "HPLC (IOC)", laboratory: "Example Lab", tested: "March 2, 2026", report: `/media/certificate/${documentId}` }]);
    expect(JSON.stringify(verified)).not.toContain("0.21"); // the unverified acidity never reaches the model
    expect(verified.laboratoryNote).toContain("measured on lot AZ-0007");
    // A product that is not for sale does not exist as far as the assistant is concerned.
    expect(hidden).toMatchObject({ isError: true });
    expect(missing).toMatchObject({ isError: true, error: expect.stringContaining("No product with that slug") });

    // Without a verified result the model is told, in words, to say so and not to estimate.
    await setLabResultVerified(manager, (await db.labResult.findFirstOrThrow({ where: { measure: "polyphenols" } })).id, false);
    const second = script(use(["get_product", { slug: "evoo" }]), say("No verified laboratory figure is available for the current lot."));
    await customerMessage(guest(), { message: "And now?" });
    const [unverified] = second.results(1);
    expect(unverified.laboratoryResults).toEqual([]);
    expect(unverified.laboratoryNote).toMatch(/^NO verified laboratory result is published for the current lot\./);
    expect(unverified.laboratoryNote).toContain("Do NOT give a polyphenol");
    expect(unverified.origin).toMatchObject({ country: "not recorded", region: "not recorded" }); // gaps are named, not left for the model to fill
    expect(unverified.origin).not.toHaveProperty("producer"); // who produces an oil is never given to the model

    // The standing instructions carry the same rule, whatever a tool returns.
    expect(CUSTOMER_INSTRUCTIONS).toContain("Never state or estimate a polyphenol content");
    expect(CUSTOMER_INSTRUCTIONS).toContain("Do not say or suggest that any product prevents, treats or cures anything");
    expect(requests[0].instructions).toBe(CUSTOMER_INSTRUCTIONS);
  });
});

describe("a conversation", () => {
  it("runs the tools the model asks for together, returns all results in one message, and replays the history unaltered", async () => {
    const ctx = guest("de-de");
    const { requests, results } = script(use(["search_products", { query: "oil" }], ["get_shipping_options", { countryCode: "be" }]), say("Wir haben ein Öl."), say("Gern geschehen."));
    const first = await customerMessage(ctx, { message: "Was haben Sie?" });
    expect(first).toMatchObject({ status: "ok", text: "Wir haben ein Öl." });

    // Request 1: the customer's words, the German situation, eight strict tools.
    expect(requests[0].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Was haben Sie?" }] }]);
    expect(requests[0].situation).toContain("Write every reply in Deutsch");
    expect(requests[0].situation).toContain("The customer is not signed in");
    expect(requests[0].tools.map((tool) => tool.name)).toEqual(["search_products", "get_product", "show_products", "propose_add_to_cart", "get_shipping_options", "search_knowledge", "get_my_orders", "request_human_help"]);
    expect(requests[0].tools.every((tool) => tool.input_schema.additionalProperties === false && tool.input_schema.required.length === Object.keys(tool.input_schema.properties).length)).toBe(true);

    // Request 2: both results, in one user message, in the order asked; prices in the customer's format.
    expect(requests[1].messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    const [search, shipping] = results(1);
    expect(search.products[0]).toMatchObject({ slug: "evoo", name: "Test Oil", page: "/de-de/products/evoo" });
    expect(search.products[0].sizes[0]).toMatchObject({ sku: "t-500", availability: "in stock" });
    expect(search.products[0].sizes[0].price.replace(/\s/g, " ")).toBe("18,00 €");
    expect(search.products[0].sizes[2].availability).toBe("sold out");
    expect(search.products.map((product: { slug: string }) => product.slug)).not.toContain("hidden");
    expect(shipping).toMatchObject({ country: "Belgien", delivers: true });

    // Turn two continues the same conversation: everything said before is sent again exactly as it was.
    await customerMessage(ctx, { conversationId: first.conversationId, message: "Danke" });
    expect(requests[2].messages.slice(0, 4)).toEqual([...requests[1].messages, { role: "assistant", content: [{ type: "text", text: "Wir haben ein Öl.", citations: null }] }]);
    expect(requests[2].messages.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: "Danke" }] });

    // Everything is on record: turns, tool calls, and an estimated cost per model call.
    const record = await getConversation(await staff("ADMINISTRATOR"), first.conversationId!);
    expect(record.turns.map((turn) => [turn.role, turn.text])).toEqual([["user", "Was haben Sie?"], ["assistant", "Wir haben ein Öl."], ["user", "Danke"], ["assistant", "Gern geschehen."]]);
    expect(record.toolCalls.map((call) => [call.name, call.ok])).toEqual([["search_products", true], ["get_shipping_options", true]]);
    expect(record.costMicros).toBe(3 * costMicros("claude-opus-5-5", USAGE));
    expect(record.locale).toBe("de-de");
  });

  it("answers the model's mistakes with a refusal it can read, and gives up politely after too many steps", async () => {
    const { results } = script(use(["delete_everything", {}], ["get_product", { slug: 42 }], ["propose_add_to_cart", { sku: "t-1000", quantity: 1 }], ["propose_add_to_cart", { sku: "t-500", quantity: 99 }]), say("Sorry about that."));
    expect((await customerMessage(guest(), { message: "Hi" })).status).toBe("ok");
    const [unknown, badArguments, soldOut, tooMany] = results(1);
    expect(unknown).toMatchObject({ isError: true, error: "There is no tool called delete_everything." });
    expect(badArguments).toMatchObject({ isError: true, error: "The arguments were not in the expected form." });
    expect(soldOut).toMatchObject({ isError: true, error: expect.stringContaining("sold out") });
    expect(tooMany).toMatchObject({ isError: true });
    expect(await db.aiToolCall.count({ where: { ok: false } })).toBe(4);

    // A model that never stops asking for tools is cut off; the customer gets an apology, not a hang.
    script(...Array.from({ length: LIMITS.modelCallsPerTurn }, () => use(["search_products", { query: null }])));
    expect(await customerMessage(guest(), { message: "Hi" })).toMatchObject({ status: "unavailable", text: "" });
  });

  it("keeps the model away from the cart: it can only offer a button", async () => {
    const ctx = guest();
    script(use(["show_products", { slugs: ["evoo", "hidden", "nope"] }], ["propose_add_to_cart", { sku: "t-750", quantity: 2 }]), say("I have put a button there for you."));
    const reply = await customerMessage(ctx, { message: "I'll take two of the 750 ml." });
    expect(reply.actions.products).toMatchObject([{ slug: "evoo", name: "Test Oil", url: "/en/products/evoo" }]); // only real, visible products are shown
    expect(reply.actions.cart).toEqual([{ sku: "t-750", quantity: 2, name: "Test Oil 750 ml", price: "€26.00" }]);
    expect(await db.cartItem.count()).toBe(0); // nothing was added
    expect(await db.cart.count()).toBe(0);
    expect((await db.variant.findUniqueOrThrow({ where: { sku: "t-750" } })).reserved).toBe(0);
  });

  it("belongs to the browser or account that started it", async () => {
    const owner = guest();
    script(say("Hello."), say("Hello again."), say("Hello, stranger."));
    const started = await customerMessage(owner, { message: "Hi" });
    expect(owner.setCookies.join()).toMatch(/azz_chat=[^;]+; Path=\/; HttpOnly/);
    expect((await customerMessage(owner, { conversationId: started.conversationId, message: "Still me" })).conversationId).toBe(started.conversationId);

    // Someone else who learns the id gets a conversation of their own, and cannot rate the first.
    const stranger = guest();
    const other = await customerMessage(stranger, { conversationId: started.conversationId, message: "Let me in" });
    expect(other.conversationId).not.toBe(started.conversationId);
    await refused(rateConversation(stranger, started.conversationId!, false), "NOT_FOUND");
    await rateConversation(owner, started.conversationId!, true);
    expect((await db.aiConversation.findUniqueOrThrow({ where: { id: started.conversationId! } })).rating).toBe(1);
  });

  it("holds messages and conversations to their limits, and survives a provider failure", async () => {
    const ctx = guest();
    await refused(customerMessage(ctx, { message: "   " }), "BAD_INPUT");
    await refused(customerMessage(ctx, { message: "x".repeat(LIMITS.messageChars + 1) }), "BAD_INPUT");

    script(new AssistantUnavailable("The provider's rate limit was reached.", true), say("Back again."));
    const failed = await customerMessage(ctx, { message: "Hello?" });
    expect(failed).toMatchObject({ status: "unavailable", text: "" });
    expect(await db.aiMessage.findFirstOrThrow({ where: { role: "error" } })).toMatchObject({ error: "The provider's rate limit was reached." });
    // The next message works, and the failure is not sent to the model as if it were part of the conversation.
    const { requests } = script(say("Back again."));
    expect(await customerMessage(ctx, { conversationId: failed.conversationId, message: "Are you back?" })).toMatchObject({ status: "ok", text: "Back again." });
    expect(requests[0].messages.map((message) => message.role)).toEqual(["user", "user"]);

    // The model declining is reported as such, with no text of its own.
    script({ ...say(""), stopReason: "refusal" });
    expect(await customerMessage(guest(), { message: "Something it will not do" })).toMatchObject({ status: "refused", text: "" });

    // A conversation that has run to its length limit asks for a fresh start instead of growing without end.
    const long = guest();
    script(say("One."));
    const opened = await customerMessage(long, { message: "One" });
    await db.aiMessage.createMany({ data: Array.from({ length: LIMITS.userTurns }, () => ({ conversationId: opened.conversationId!, role: "user", text: "filler", content: [{ type: "text", text: "filler" }] })) });
    expect(await customerMessage(long, { conversationId: opened.conversationId, message: "One more" })).toMatchObject({ status: "limit" });
  });
});

describe("orders", () => {
  async function customerWithOrder(email: string) {
    const customer = await db.customer.create({ data: { email, firstName: "Greta", lastName: "Kunde", passwordHash: "x" } });
    const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
    const order = await db.order.create({
      data: {
        ...BILL,
        customerId: customer.id,
        shipFirstName: "Greta",
        shipLastName: "Kunde",
        shipLine1: "Teststraße 1",
        shipPostalCode: "1000",
        shipCity: "Brussels",
        shipCountryCode: "BE",
        email,
        status: "PARTIALLY_SHIPPED",
        paymentStatus: "PAID",
        fulfilmentStatus: "PARTIALLY_SHIPPED",
        paidAt: new Date(),
        subtotalCents: 5400,
        shippingCents: 695,
        totalCents: 6095,
        shippingRateName: "Standard",
        weightGrams: 2850,
        number: `AZZ-${Math.floor(Math.random() * 90000) + 10000}`,
        items: { create: [{ variantId: variant.id, sku: "t-500", productName: "Test Oil", variantLabel: "500 ml", unitPriceCents: 1800, quantity: 3, shippedQuantity: 2, lineTotalCents: 5400 }] },
      },
      include: { items: true },
    });
    await db.shipment.create({ data: { orderId: order.id, carrier: "bpost", trackingNumber: "3232000111", trackingUrl: "https://track.example/3232000111", status: "IN_TRANSIT", source: "manual", shippedAt: new Date(), estimatedDeliveryAt: new Date("2026-11-20T12:00:00Z"), items: { create: [{ orderItemId: order.items[0].id, quantity: 2 }] }, events: { create: [{ occurredAt: new Date(), description: "Arrived at the Brussels depot" }] } } });
    return { customer, order };
  }

  it("shows a signed-in customer each shipment of their own orders, and shows a guest nothing", async () => {
    const mine = await customerWithOrder("greta@example.com");
    const theirs = await customerWithOrder("someone-else@example.com");

    const signedIn: Ctx = { ...guest(), customer: mine.customer };
    const { requests, results } = script(use(["get_my_orders", { orderNumber: null }], ["get_my_orders", { orderNumber: theirs.order.number }]), say("Your first parcel is on its way."));
    await customerMessage(signedIn, { message: "Where is my order?" });
    expect(requests[0].situation).toContain("The customer is signed in; their first name is Greta");
    const [own, notOwn] = results(1);
    expect(own).toMatchObject({ signedIn: true, found: 1 });
    expect(own.orders[0]).toMatchObject({ number: mine.order.number, status: "PARTIALLY_SHIPPED", stillToCome: ["1 × Test Oil 500 ml (being prepared)"] });
    expect(own.orders[0].shipments).toMatchObject([{ shipment: "1 of 2", contains: ["2 × Test Oil 500 ml"], carrier: "bpost", trackingNumber: "3232000111", trackingLink: "https://track.example/3232000111", status: "IN_TRANSIT", carrierEstimate: "November 20, 2026", carrierReportsAProblem: false }]);
    expect(own.orders[0].shipments[0].latestUpdate).toContain("Arrived at the Brussels depot");
    // Another customer's order number finds nothing, even for a signed-in customer.
    expect(notOwn).toMatchObject({ found: 0 });
    expect(JSON.stringify(notOwn)).not.toContain("someone-else");

    const anonymous = script(use(["get_my_orders", { orderNumber: mine.order.number }]), say("Please sign in to see your orders."));
    await customerMessage(guest(), { message: `Where is ${mine.order.number}?` });
    const [guestView] = anonymous.results(1);
    expect(guestView).toMatchObject({ signedIn: false, account: "/en/account", tracking: "/en/order-tracking" });
    expect(JSON.stringify(guestView)).not.toContain("3232000111"); // no tracking number, no order data
  });
});

describe("passing a question to a person", () => {
  it("needs an address to reply to, creates one request, tells the shop, and marks the conversation", async () => {
    const ctx = guest("fr-be");
    const { results } = script(use(["request_human_help", { subject: "Damaged bottle", summary: "The customer says a bottle arrived broken and wants a replacement.", email: null, name: null, orderNumber: null, urgent: true }]), say("Quelle est votre adresse e-mail ?"));
    const asked = await customerMessage(ctx, { message: "Ma bouteille est arrivée cassée." });
    expect(results(1)[0]).toMatchObject({ isError: true, error: expect.stringContaining("An email address is needed") });
    expect(asked.actions.handover).toBeNull();
    expect(await db.supportRequest.count()).toBe(0);

    const second = script(use(["request_human_help", { subject: "Damaged bottle", summary: "The customer says a bottle arrived broken and wants a replacement.", email: "Marie@Example.com", name: "Marie", orderNumber: "azz-1042", urgent: true }], ["request_human_help", { subject: "Again", summary: "The same thing, asked a second time.", email: "marie@example.com", name: null, orderNumber: null, urgent: false }]), say("C’est transmis."));
    const done = await customerMessage(ctx, { conversationId: asked.conversationId, message: "marie@example.com" });
    expect(done.actions.handover).toEqual({ reference: "S-00001" });
    expect(second.results(1)[1]).toMatchObject({ reference: "S-00001", note: expect.stringContaining("already been passed") });
    expect(await db.supportRequest.findMany()).toMatchObject([{ email: "marie@example.com", name: "Marie", orderNumber: "AZZ-1042", urgent: true, status: "OPEN", locale: "fr-be", source: "assistant", conversationId: asked.conversationId }]);
    expect((await db.aiConversation.findUniqueOrThrow({ where: { id: asked.conversationId! } })).status).toBe("HANDED_OVER");

    // The shop gets one email, marked urgent, with the summary.
    await db.setting.create({ data: { key: "notifications", value: { emailRecipient: "owner@test.local" } } });
    const sent: { subject: string; text: string }[] = [];
    await processJobs(db, { env: { RESEND_API_KEY: "re_test_placeholder", EMAIL_FROM: "shop@test.local" }, transport: async (_url, init) => (sent.push(JSON.parse(init.body)), { ok: true, status: 200, text: async () => "" }) });
    expect(sent).toMatchObject([{ subject: "Urgent: Damaged bottle" }]);
    expect(sent[0].text).toContain("a bottle arrived broken");

    // Staff see it, and record that they have answered.
    const [support, analyst] = [await staff("STAFF"), { ...(await staff("MANAGER")), admin: null }];
    await refused(listSupportRequests(analyst), "UNAUTHENTICATED");
    const list = await listSupportRequests(support, "OPEN");
    expect(list).toMatchObject({ open: 1, urgent: 1, rows: [{ reference: "S-00001" }] });
    await setSupportStatus(support, list.rows[0].id, { status: "ANSWERED", staffNote: "Replacement sent." });
    expect(await listSupportRequests(support)).toMatchObject({ open: 0, rows: [{ status: "ANSWERED", handledBy: "STAFF", staffNote: "Replacement sent." }] });
  });
});

describe("the knowledge base", () => {
  it("lets the assistant quote only published articles meant for customers", async () => {
    const [manager, worker] = [await staff("MANAGER"), await staff("STAFF")];
    await refused(saveArticle(worker, null, { title: "Storing olive oil", slug: "storing-olive-oil", body: "Keep olive oil in a cool, dark place, with the cap closed.", isPublished: true }), "FORBIDDEN");
    await saveArticle(manager, null, { title: "Storing olive oil", slug: "storing-olive-oil", body: "Keep olive oil in a cool, dark place, with the cap closed.", isPublished: true });
    await saveArticle(manager, null, { title: "Storing oil: draft", slug: "storing-draft", body: "A draft about storing olive oil that is not ready yet.", isPublished: false });
    await saveArticle(manager, null, { title: "Storing stock (staff)", slug: "storing-staff", body: "Staff note about storing olive oil stock in the warehouse.", audience: "staff", isPublished: true });
    await refused(saveArticle(manager, null, { title: "Copy", slug: "storing-olive-oil", body: "Another article with the same address name." }), "BAD_INPUT");

    const { results } = script(use(["search_knowledge", { query: "how to store olive oil" }], ["search_knowledge", { query: "quantum chromodynamics" }]), say("Keep it cool and dark."));
    await customerMessage(guest(), { message: "How do I store it?" });
    const [found, nothing] = results(1);
    expect(found.articles).toEqual([{ title: "Storing olive oil", text: "Keep olive oil in a cool, dark place, with the cap closed." }]);
    expect(nothing).toMatchObject({ found: 0, note: expect.stringContaining("Say you do not have that information") });
  });
});

describe("personal data", () => {
  it("includes conversations in a customer's export, removes them on erasure, and deletes old guest conversations", async () => {
    const customer = await db.customer.create({ data: { email: "greta@example.com", firstName: "Greta", lastName: "Kunde", passwordHash: "x" } });
    script(say("Hello Greta."), say("Hello, guest."));
    await customerMessage({ ...guest(), customer }, { message: "Hello" });
    const anonymous = await customerMessage(guest(), { message: "Hello" });

    expect((await exportCustomerData(db, customer.id)).assistantConversations).toMatchObject([{ language: "en", messages: [{ from: "you", text: "Hello" }, { from: "assistant", text: "Hello Greta." }] }]);
    await eraseCustomerData(db, customer.id);
    expect(await db.aiConversation.count({ where: { customerId: customer.id } })).toBe(0);
    expect(await db.aiConversation.count()).toBe(1); // the guest's is untouched

    expect(await purgeOldConversations(db, new Date(Date.now() + 89 * 86_400_000))).toBe(0);
    expect(await purgeOldConversations(db, new Date(Date.now() + 91 * 86_400_000))).toBe(1);
    expect(await db.aiMessage.count({ where: { conversationId: anonymous.conversationId! } })).toBe(0);
  });
});

describe("the endpoint and the staff overview", () => {
  const call = (body: object, headers: Record<string, string> = {}) => assistantRoute(new Request("http://localhost:3000/api/assistant", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.3.3.3", ...headers }, body: JSON.stringify(body) }));

  it("answers same-site requests only, and never reveals why it is unavailable", async () => {
    script(say("Guten Tag."));
    const ok = await call({ message: "Hallo" }, { "x-azz-locale": "de-de", origin: "http://localhost:3000" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.getSetCookie().join()).toMatch(/azz_chat=[^;]+;.*HttpOnly/);
    expect(await ok.json()).toMatchObject({ status: "ok", text: "Guten Tag.", actions: { products: [], cart: [], handover: null } });
    expect((await db.aiConversation.findFirstOrThrow()).locale).toBe("de-de");

    expect((await call({ message: "Hallo" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call({ message: 7 })).status).toBe(400);
    expect((await call({ message: "x".repeat(9000) })).status).toBe(413);
    expect((await call({ conversationId: "nosuchconversation", helpful: true })).status).toBe(404);

    setModelProvider(null);
    const down = await call({ message: "Hallo" });
    expect(await down.json()).toEqual({ conversationId: null, status: "unavailable", text: "", actions: { products: [], cart: [], handover: null } });
  });

  it("shows staff the state, the spending and exactly what the assistant can do", async () => {
    script(use(["search_products", { query: null }]), say("Here is what we have."));
    await customerMessage(guest(), { message: "What do you sell?" });
    const overview = await assistantOverview(await staff("ADMINISTRATOR"));
    expect(overview).toMatchObject({ state: { available: true, reason: "ok", model: "claude-opus-5-5", budgetCents: 5000 }, month: { conversations: 1, messages: 1, toolCalls: 1, handovers: 0 } });
    expect(overview.state.spentMicros).toBe(2 * costMicros("claude-opus-5-5", USAGE));
    expect(overview.recent).toMatchObject([{ opening: "What do you sell?", toolCalls: 1, signedIn: false }]);
    expect(overview.tools).toHaveLength(8);
    expect(overview.toolUsage).toEqual([{ name: "search_products", ok: 1, failed: 0 }]);
    await refused(assistantOverview({ ...(await staff("STAFF")), admin: null }), "UNAUTHENTICATED");
  });
});
