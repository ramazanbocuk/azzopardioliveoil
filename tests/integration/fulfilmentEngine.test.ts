import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";
import { adjustStock, createShipment, dashboard, refundOrder, saveBatch } from "@/server/admin";
import { releaseExpiredReservations } from "@/server/checkout";
import type { Ctx } from "@/server/context";
import { processJobs } from "@/server/jobs";
import { applyPaymentEvent, setPaymentProvider, type PaymentProvider } from "@/server/payments";
import { cancelOutstanding, listBackorders, splitQuantity } from "@/server/stock";
import { code, createAdmin, createClient, db, resetDb, seedCatalog } from "../helpers";

const server = createServer(storefrontSchema);
const ADDRESS = { firstName: "Greta", lastName: "Kunde", line1: "Teststraße 1", postalCode: "1000", city: "Brussels", countryCode: "BE" };
const refunds: number[] = [];
const fakeProvider: PaymentProvider = {
  name: "STRIPE",
  createCheckout: async ({ order }) => ({ providerRef: `cs_test_${order.number}`, url: "https://pay.example" }),
  parseWebhook: () => {
    throw new Error("unused");
  },
  refund: async ({ amountCents }) => `re_${refunds.push(amountCents)}`,
};

async function staff(role: "ADMINISTRATOR" | "MANAGER" | "STAFF"): Promise<Ctx> {
  const { email } = await createAdmin(role);
  return { db, ip: "10.9.9.9", userAgent: null, cookies: {}, setCookies: [], customer: null, admin: await db.adminUser.findUniqueOrThrow({ where: { email } }) };
}
const refused = async (promise: Promise<unknown>, expected: string) => expect(await promise.then(() => "resolved", (error: { code?: string }) => error.code)).toBe(expected);
const stockOf = async (sku: string) => {
  const variant = await db.variant.findUniqueOrThrow({ where: { sku } });
  return [variant.stock, variant.reserved];
};

let rateId: string;
let productId: string;
let manager: Ctx;
let packer: Ctx;

/** Places an order through the real checkout and, unless told otherwise, pays it through the real payment handler. */
async function order(lines: [sku: string, quantity: number][], options: { locale?: string; pay?: boolean } = {}) {
  const c = createClient(server);
  const headers = { "x-azz-locale": options.locale ?? "en" };
  for (const [sku, quantity] of lines) {
    const added = await c.gql(`mutation ($s: String!, $q: Int!) { cartAdd(sku: $s, quantity: $q) { itemCount } }`, { s: sku, q: quantity }, headers);
    if (added.errors) throw new Error(JSON.stringify(added.errors));
  }
  const placed = await c.gql<{ checkout: { number: string; accessToken: string; totalCents: number } }>(`mutation ($input: CheckoutInput!) { checkout(input: $input) { number accessToken totalCents } }`, { input: { email: "greta@example.com", shippingRateId: rateId, address: ADDRESS } }, headers);
  if (!placed.data) throw new Error(JSON.stringify(placed.errors));
  const { number, accessToken, totalCents } = placed.data.checkout;
  if (options.pay !== false) {
    await c.gql(`mutation ($n: String!, $t: String!) { startPayment(number: $n, token: $t) }`, { n: number, t: accessToken });
    expect(await applyPaymentEvent(db, "STRIPE", { eventId: `evt_${number}`, type: "checkout.session.completed", outcome: "paid", providerRef: `cs_test_${number}`, amountCents: totalCents, currency: "EUR", method: "card" })).toBe("paid");
    await db.outboxJob.deleteMany(); // the order confirmation is not what these tests are about
  }
  const row = await db.order.findUniqueOrThrow({ where: { number }, include: { items: { include: { backorder: true }, orderBy: { sku: "asc" } } } });
  return { c, number, accessToken, id: row.id, items: row.items, line: (sku: string) => row.items.find((item) => item.sku === sku)!.id };
}

const ORDER_VIEW = `query ($n: String!, $t: String!) { orderByToken(number: $n, token: $t) { status items { sku quantity shippedQuantity toFollow awaitingStock cancelledQuantity } shipments { carrier trackingNumber status items { sku quantity lotNumber } } } }`;
type OrderView = { orderByToken: { status: string; items: { sku: string; quantity: number; shippedQuantity: number; toFollow: number; awaitingStock: number; cancelledQuantity: number }[]; shipments: { carrier: string; trackingNumber: string | null; status: string; items: { sku: string; quantity: number; lotNumber: string | null }[] }[] } };

beforeEach(async () => {
  await resetDb();
  const seeded = await seedCatalog();
  rateId = seeded.expressRateId; // never free, so totals do not depend on thresholds
  productId = seeded.product.id;
  manager = await staff("MANAGER");
  packer = await staff("STAFF");
  refunds.length = 0;
  setPaymentProvider(fakeProvider);
});
afterAll(() => setPaymentProvider(undefined));

describe("one order, several shipments (acceptance test 5)", () => {
  it("sends five products in two parcels with their own tracking, tells the customer twice in their language, and shows both under one order", async () => {
    // Five different products, as the brief has it.
    const category = await db.category.findFirstOrThrow();
    for (const letter of ["a", "b", "c", "d", "e"]) {
      await db.product.create({ data: { slug: `oil-${letter}`, name: `Olive Oil ${letter.toUpperCase()}`, categoryId: category.id, isVisible: true, variants: { create: [{ sku: `oil-${letter}`, label: "500 ml", volumeMl: 500, priceCents: 2000, weightGrams: 950, stock: 20 }] } } });
    }
    const placed = await order([["oil-a", 2], ["oil-b", 1], ["oil-c", 1], ["oil-d", 1], ["oil-e", 1]], { locale: "de-de" });
    const view = async () => (await placed.c.gql<OrderView>(ORDER_VIEW, { n: placed.number, t: placed.accessToken })).data!.orderByToken;

    // Day one: A, C and E leave.
    await createShipment(packer, placed.id, { carrier: "bpost", trackingNumber: "BP-111", trackingUrl: "https://track.example/BP-111", items: [{ orderItemId: placed.line("oil-a"), quantity: 2 }, { orderItemId: placed.line("oil-c"), quantity: 1 }, { orderItemId: placed.line("oil-e"), quantity: 1 }] });
    expect((await view()).status).toBe("PARTIALLY_SHIPPED"); // never "shipped" while anything is owed
    await refused(createShipment(packer, placed.id, { carrier: "bpost", items: [{ orderItemId: placed.line("oil-a"), quantity: 1 }] }), "BAD_INPUT"); // A has all gone
    await refused(createShipment(packer, placed.id, { carrier: "bpost", items: [{ orderItemId: placed.line("oil-b"), quantity: 2 }] }), "BAD_INPUT"); // only one B was ordered

    // A week later: B and D follow, with another carrier and another number.
    await createShipment(packer, placed.id, { carrier: "DHL", trackingNumber: "DHL-222", items: [{ orderItemId: placed.line("oil-b"), quantity: 1 }, { orderItemId: placed.line("oil-d"), quantity: 1 }] });
    await refused(createShipment(packer, placed.id, { carrier: "DHL" }), "BAD_INPUT"); // nothing left

    // The customer sees one order with two shipments, each with its own contents and tracking.
    const seen = await view();
    expect(seen.status).toBe("SHIPPED");
    expect(seen.shipments.map((shipment) => [shipment.carrier, shipment.trackingNumber, shipment.items.map((line) => `${line.quantity}x${line.sku}`).sort()])).toEqual([
      ["bpost", "BP-111", ["1xoil-c", "1xoil-e", "2xoil-a"]],
      ["DHL", "DHL-222", ["1xoil-b", "1xoil-d"]],
    ]);
    expect(seen.items.every((item) => item.toFollow === 0 && item.shippedQuantity === item.quantity)).toBe(true);
    expect(await db.shipment.count({ where: { orderId: placed.id } })).toBe(2);
    expect(await db.order.count()).toBe(1);

    // One email per shipment, in German, each about its own parcel.
    await db.setting.upsert({ where: { key: "notifications" }, create: { key: "notifications", value: {} }, update: {} });
    const sent: { subject: string; text: string }[] = [];
    const report = await processJobs(db, { env: { RESEND_API_KEY: "re_test_placeholder", EMAIL_FROM: "shop@test.local" }, transport: async (_url, init) => (sent.push(JSON.parse(init.body)), { ok: true, status: 200, text: async () => "" }) });
    expect(report).toMatchObject({ claimed: 2, done: 2 });
    const [first, second] = sent.sort((a, b) => (a.text.includes("BP-111") ? -1 : 1) - (b.text.includes("BP-111") ? -1 : 1));

    expect(first.subject).toBe(`Ein Teil Ihrer Azzopardi-Bestellung ${placed.number} ist unterwegs`);
    expect(first.text).toContain("https://track.example/BP-111");
    expect(first.text).toContain("In diesem Paket:\n- Olive Oil A 500 ml x 2\n- Olive Oil C 500 ml x 1\n- Olive Oil E 500 ml x 1");
    expect(first.text).toContain("Folgt noch:\n- Olive Oil B 500 ml x 1\n- Olive Oil D 500 ml x 1");
    expect(first.text).toContain("Der Rest folgt in einem separaten Paket.");
    expect(first.text).not.toContain("DHL-222");

    expect(second.subject).toBe(`Ein Teil Ihrer Azzopardi-Bestellung ${placed.number} ist unterwegs`);
    expect(second.text).toContain("Sendungsnummer: DHL-222");
    expect(second.text).toContain("In diesem Paket:\n- Olive Oil B 500 ml x 1\n- Olive Oil D 500 ml x 1");
    expect(second.text).toContain("Mit diesem Paket ist Ihre Bestellung vollständig.");
    expect(second.text).not.toContain("Olive Oil A");
    expect(second.text).not.toContain("BP-111");
  });

  it("records the lot of each shipped line, and refuses a lot that is not this product's", async () => {
    await saveBatch(manager, null, { lotNumber: "AZ-0001", productId, isPublished: true });
    await saveBatch(manager, null, { lotNumber: "AZ-0002", productId, isPublished: true });
    const other = await db.product.findFirstOrThrow({ where: { slug: "hidden" } });
    await saveBatch(manager, null, { lotNumber: "HID-0001", productId: other.id, isPublished: true });
    const placed = await order([["t-500", 4]]);
    const item = placed.line("t-500");

    await refused(createShipment(packer, placed.id, { carrier: "bpost", items: [{ orderItemId: item, quantity: 1, lotNumber: "AZ-9999" }] }), "BAD_INPUT"); // a typing slip
    await refused(createShipment(packer, placed.id, { carrier: "bpost", items: [{ orderItemId: item, quantity: 1, lotNumber: "HID-0001" }] }), "BAD_INPUT"); // another product's lot
    await createShipment(packer, placed.id, { carrier: "bpost", items: [{ orderItemId: item, quantity: 3, lotNumber: "az-0001" }] });
    await createShipment(packer, placed.id, { carrier: "bpost", items: [{ orderItemId: item, quantity: 1, lotNumber: "AZ-0002" }] });

    // Two parcels of one product, from two bottlings: each is traceable on its own.
    expect((await db.shipmentItem.findMany({ orderBy: { quantity: "desc" } })).map((line) => [line.quantity, line.lotNumber])).toEqual([[3, "AZ-0001"], [1, "AZ-0002"]]);
    const seen = (await placed.c.gql<OrderView>(ORDER_VIEW, { n: placed.number, t: placed.accessToken })).data!.orderByToken;
    expect(seen.shipments.map((shipment) => shipment.items[0].lotNumber)).toEqual(["AZ-0001", "AZ-0002"]);
  });
});

describe("backorders", () => {
  it("are refused unless the owner has switched them on for the product", async () => {
    expect(splitQuantity(2, 5, false)).toBeNull();
    expect(splitQuantity(2, 5, true)).toEqual({ fromStock: 2, backorder: 3 });
    expect(splitQuantity(-1, 2, true)).toEqual({ fromStock: 0, backorder: 2 });
    expect(splitQuantity(9, 5, false)).toEqual({ fromStock: 5, backorder: 0 });

    const c = createClient(server);
    expect(code(await c.gql(`mutation { cartAdd(sku: "t-1000", quantity: 1) { itemCount } }`))).toBe("OUT_OF_STOCK"); // none in stock, switch off
    await db.product.update({ where: { id: productId }, data: { allowBackorder: true } });
    const added = await c.gql<{ cartAdd: { lines: { sku: string; enoughStock: boolean; backorderQuantity: number }[] } }>(`mutation { cartAdd(sku: "t-1000", quantity: 2) { lines { sku enoughStock backorderQuantity } } }`);
    expect(added.data?.cartAdd.lines).toEqual([{ sku: "t-1000", enoughStock: true, backorderQuantity: 2 }]);
  });

  it("hold what is on the shelf, owe the rest, and ship it only once it has arrived", async () => {
    await db.product.update({ where: { id: productId }, data: { allowBackorder: true } });
    await db.variant.update({ where: { sku: "t-500" }, data: { stock: 2 } });

    const unpaid = await order([["t-500", 5]], { pay: false });
    expect(unpaid.items[0]).toMatchObject({ quantity: 5, backorderQuantity: 3 });
    expect(await stockOf("t-500")).toEqual([2, 2]); // two held, none sold yet
    expect(await db.stockReservation.findMany()).toMatchObject([{ quantity: 2, status: "HELD", orderId: unpaid.id }]);
    expect(await db.backorder.count()).toBe(0); // nothing is owed before the money arrives

    const c = unpaid.c;
    await c.gql(`mutation ($n: String!, $t: String!) { startPayment(number: $n, token: $t) }`, { n: unpaid.number, t: unpaid.accessToken });
    const total = (await db.order.findUniqueOrThrow({ where: { id: unpaid.id } })).totalCents;
    await applyPaymentEvent(db, "STRIPE", { eventId: "evt_bo", type: "checkout.session.completed", outcome: "paid", providerRef: `cs_test_${unpaid.number}`, amountCents: total, currency: "EUR", method: "card" });
    expect(await stockOf("t-500")).toEqual([0, 0]);
    expect((await db.stockReservation.findFirstOrThrow()).status).toBe("CONVERTED");
    expect(await db.backorder.findFirstOrThrow()).toMatchObject({ quantity: 3, filledQuantity: 0, closedAt: null });

    const item = unpaid.line("t-500");
    await refused(createShipment(packer, unpaid.id, { carrier: "bpost", items: [{ orderItemId: item, quantity: 3 }] }), "BAD_INPUT"); // three are not on the shelf
    await createShipment(packer, unpaid.id, { carrier: "bpost", trackingNumber: "ONE" }); // "everything ready": the two that exist
    const afterFirst = (await c.gql<OrderView>(ORDER_VIEW, { n: unpaid.number, t: unpaid.accessToken })).data!.orderByToken;
    expect(afterFirst.status).toBe("PARTIALLY_SHIPPED");
    expect(afterFirst.items[0]).toMatchObject({ shippedQuantity: 2, toFollow: 3, awaitingStock: 3 });
    await refused(createShipment(packer, unpaid.id, { carrier: "bpost" }), "BAD_INPUT"); // nothing in stock for it yet

    // A delivery of two arrives: it is set aside for this order before it goes on sale.
    await adjustStock(manager, (await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } })).id, 2, "RECEIVED");
    expect(await stockOf("t-500")).toEqual([0, 0]);
    expect(await db.backorder.findFirstOrThrow()).toMatchObject({ filledQuantity: 2, closedAt: null });
    await refused(createShipment(packer, unpaid.id, { carrier: "bpost", items: [{ orderItemId: item, quantity: 3 }] }), "BAD_INPUT");
    await createShipment(packer, unpaid.id, { carrier: "bpost", trackingNumber: "TWO", items: [{ orderItemId: item, quantity: 2 }] });

    // The last bottle arrives with four others: one for this order, four for the shop.
    await adjustStock(manager, (await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } })).id, 5, "RECEIVED");
    expect(await stockOf("t-500")).toEqual([4, 0]);
    expect((await db.backorder.findFirstOrThrow()).closedAt).not.toBeNull();
    await createShipment(packer, unpaid.id, { carrier: "bpost", trackingNumber: "THREE" });
    const done = (await c.gql<OrderView>(ORDER_VIEW, { n: unpaid.number, t: unpaid.accessToken })).data!.orderByToken;
    expect(done.status).toBe("SHIPPED");
    expect(done.shipments.map((shipment) => [shipment.trackingNumber, shipment.items[0].quantity])).toEqual([["ONE", 2], ["TWO", 2], ["THREE", 1]]);
    // Every bottle that left stock for this order has a ledger entry naming it.
    expect((await db.inventoryMovement.findMany({ where: { orderId: unpaid.id } })).reduce((sum, movement) => sum + movement.delta, 0)).toBe(-5);
    expect((await db.orderEvent.findMany({ where: { orderId: unpaid.id, kind: "backorder_filled" } })).every((event) => event.isInternal)).toBe(true);
  });

  it("serve the customer who has waited longest, and are listed for the warehouse", async () => {
    await db.product.update({ where: { id: productId }, data: { allowBackorder: true } });
    await db.variant.update({ where: { sku: "t-750" }, data: { stock: 0 } });
    const first = await order([["t-750", 2]]);
    const second = await order([["t-750", 3]]);

    const list = await listBackorders(packer);
    expect(list).toMatchObject({ units: 5, replenish: [{ sku: "t-750", open: 5, orders: 2 }] });
    expect(list.lines.map((line) => [line.number, line.open])).toEqual([[first.number, 2], [second.number, 3]]);
    expect(await dashboard(manager)).toMatchObject({ backorderedUnits: 5, backorderedOrders: 2, partlyShipped: 0 });

    await adjustStock(manager, (await db.variant.findUniqueOrThrow({ where: { sku: "t-750" } })).id, 3, "RECEIVED");
    const after = await db.backorder.findMany({ orderBy: { createdAt: "asc" } });
    expect(after.map((row) => row.filledQuantity)).toEqual([2, 1]); // the first order is made whole before the second gets any
    expect(await stockOf("t-750")).toEqual([0, 0]);
    expect((await listBackorders(packer)).units).toBe(2);
    await refused(listBackorders({ ...packer, admin: null }), "UNAUTHENTICATED");
  });

  it("are freed for a waiting customer when another order's hold lapses", async () => {
    await db.product.update({ where: { id: productId }, data: { allowBackorder: true } });
    await db.variant.update({ where: { sku: "t-500" }, data: { stock: 2 } });
    const holder = await order([["t-500", 2]], { pay: false }); // holds both bottles, never pays
    const waiting = await order([["t-500", 2]]); // paid, entirely on backorder
    expect(await db.backorder.findFirstOrThrow()).toMatchObject({ orderId: waiting.id, quantity: 2, filledQuantity: 0 });

    expect(await releaseExpiredReservations(db, new Date(Date.now() + 48 * 3600_000))).toBe(1);
    expect((await db.stockReservation.findFirstOrThrow({ where: { orderId: holder.id } })).status).toBe("RELEASED");
    expect(await db.backorder.findFirstOrThrow()).toMatchObject({ filledQuantity: 2 });
    expect(await stockOf("t-500")).toEqual([0, 0]);
    await createShipment(packer, waiting.id, { carrier: "bpost" });
  });
});

describe("taking units off a paid order", () => {
  it("cancels what is waiting for stock first, returns the rest to sale, and moves no money", async () => {
    await db.product.update({ where: { id: productId }, data: { allowBackorder: true } });
    await db.variant.update({ where: { sku: "t-500" }, data: { stock: 3 } });
    const placed = await order([["t-500", 5]]); // three from stock, two on backorder
    const item = placed.line("t-500");

    await refused(cancelOutstanding(packer, item, 1), "FORBIDDEN");
    await refused(cancelOutstanding(manager, item, 6), "BAD_INPUT");
    await refused(cancelOutstanding(manager, item, 0), "BAD_INPUT");

    // Two units: both come off the backorder, nothing returns to the shelf.
    await cancelOutstanding(manager, item, 2);
    expect(await db.backorder.findFirstOrThrow()).toMatchObject({ cancelledQuantity: 2 });
    expect((await db.backorder.findFirstOrThrow()).closedAt).not.toBeNull();
    expect(await stockOf("t-500")).toEqual([0, 0]);

    // One more: that one had been taken from stock, so it goes back on sale.
    const { valueCents } = await cancelOutstanding(manager, item, 1);
    expect(valueCents).toBe(1800);
    expect(await stockOf("t-500")).toEqual([1, 0]);
    expect(await db.orderItem.findUniqueOrThrow({ where: { id: item } })).toMatchObject({ quantity: 5, cancelledQuantity: 3, shippedQuantity: 0 });
    expect(await db.refund.count()).toBe(0); // the refund is a separate, deliberate step
    expect(await db.orderEvent.count({ where: { kind: "refund_due", isInternal: true } })).toBe(2);

    // The two that remain ship, and the order is then complete: removed units are no longer owed.
    await refused(createShipment(packer, placed.id, { carrier: "bpost", items: [{ orderItemId: item, quantity: 3 }] }), "BAD_INPUT");
    await createShipment(packer, placed.id, { carrier: "bpost" });
    const seen = (await placed.c.gql<OrderView>(ORDER_VIEW, { n: placed.number, t: placed.accessToken })).data!.orderByToken;
    expect(seen.status).toBe("SHIPPED");
    expect(seen.items[0]).toMatchObject({ shippedQuantity: 2, cancelledQuantity: 3, toFollow: 0 });
    await refused(cancelOutstanding(manager, item, 1), "BAD_INPUT"); // nothing left that has not shipped
  });

  it("closes what is still owed when the order is refunded in full, and restocks only what had left the shelf", async () => {
    const boss = await staff("ADMINISTRATOR");
    await db.product.update({ where: { id: productId }, data: { allowBackorder: true } });
    await db.variant.update({ where: { sku: "t-500" }, data: { stock: 1 } });
    const placed = await order([["t-500", 4]]); // one from stock, three owed
    const total = (await db.order.findUniqueOrThrow({ where: { id: placed.id } })).totalCents;

    await refundOrder(boss, placed.id, { amountCents: total, restock: true });
    expect(await db.backorder.findFirstOrThrow()).toMatchObject({ quantity: 3, cancelledQuantity: 3 });
    expect(await stockOf("t-500")).toEqual([1, 0]); // one came back, not four
    // A delivery after the refund goes on sale; it is not set aside for an order that is owed nothing.
    await adjustStock(manager, (await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } })).id, 5, "RECEIVED");
    expect(await stockOf("t-500")).toEqual([6, 0]);
    expect((await listBackorders(packer)).units).toBe(0);
  });
});
