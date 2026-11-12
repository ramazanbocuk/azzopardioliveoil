import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminRole } from "@/generated/prisma/client";
import * as admin from "@/server/admin";
import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { bookLabel, bulkBookLabels, cancelBooking, compareRates, fulfilmentBoard, getLabel, openAttempts, refreshTracking, releaseAttempt } from "@/server/fulfilment";
import { CarrierError, type ShipmentRequest, type ShippingCarrier, type Tracking } from "@/server/shipping/carriers";
import { setCarriers } from "@/server/shipping/registry";
import { BILL, db, resetDb, seedCatalog } from "../helpers";

async function as(role: AdminRole): Promise<Ctx> {
  const user = await db.adminUser.create({ data: { email: `${role}-${Math.random().toString(36).slice(2)}@test.local`, name: role, role, passwordHash: "x" } });
  return { db, ip: "10.9.9.9", userAgent: null, cookies: {}, setCookies: [], customer: null, admin: user };
}

async function refused(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).message).toMatch(pattern);
}

async function paidOrder(country = "BE", hsCode: string | null = null) {
  const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
  const order = await db.order.create({
    data: {
      ...BILL,
      shipFirstName: "Ada",
      shipLastName: "Buyer",
      shipLine1: "Hoofdstraat 5",
      shipPostalCode: "2000",
      shipCity: "Antwerp",
      shipCountryCode: country,
      email: "ada@example.com",
      status: "PAID",
      paymentStatus: "PAID",
      paidAt: new Date(),
      subtotalCents: 3600,
      shippingCents: 695,
      totalCents: 4295,
      shippingRateName: "Standard",
      weightGrams: 1900,
      number: `AZZ-${Math.floor(Math.random() * 90000) + 10000}`,
      items: { create: [{ variantId: variant.id, sku: "t-500", productName: "Test Oil", variantLabel: "500 ml", unitPriceCents: 1800, quantity: 2, lineTotalCents: 3600, weightGrams: 950, hsCode, originCountry: hsCode ? "IT" : null }] },
    },
  });
  return order.id;
}

/** A stand-in carrier for testing the shop's own bookkeeping. It is never registered outside tests. */
function testCarrier(over: Partial<ShippingCarrier> = {}) {
  const seen: { booked: { request: ShipmentRequest; service: string }[]; cancelled: string[]; tracking: Tracking } = { booked: [], cancelled: [], tracking: { status: "IN_TRANSIT", deliveredAt: null, events: [{ at: new Date("2026-11-13T18:00:00Z"), description: "Picked up", location: "Brussels" }] } };
  const carrier: ShippingCarrier = {
    key: "testcarrier",
    name: "Test Carrier",
    requires: [],
    environment: "test",
    services: [{ code: "STD", name: "Standard" }],
    rates: async () => [
      { carrier: "testcarrier", carrierName: "Test Carrier", service: "EXP", serviceName: "Express", priceCents: 2500, currency: "EUR", estimatedDelivery: new Date("2026-11-14T12:00:00Z") },
      { carrier: "testcarrier", carrierName: "Test Carrier", service: "STD", serviceName: "Standard", priceCents: 900, currency: "EUR", estimatedDelivery: new Date("2026-11-17T12:00:00Z") },
    ],
    book: async (request, service) => {
      seen.booked.push({ request, service });
      return { carrierRef: `ref-${seen.booked.length}`, trackingNumber: `TRK${seen.booked.length}`, trackingUrl: "https://track.example/1", boxTrackingNumbers: request.boxes.map((_, index) => `TRK${seen.booked.length}-${index + 1}`), labels: [{ mime: "application/pdf", data: Buffer.from("%PDF label") }], costCents: 900, estimatedDelivery: new Date("2026-11-17T12:00:00Z") };
    },
    cancel: async ({ carrierRef }) => {
      seen.cancelled.push(carrierRef);
    },
    track: async () => seen.tracking,
    ...over,
  };
  return { carrier, seen };
}

const ORIGIN = { senderName: "Azzopardi", senderLine1: "Olijfstraat 12", senderPostalCode: "1000", senderCity: "Brussels", senderCountryCode: "BE", senderPhone: "+3221234567", carrierRule: "cheapest" };
const BOX = [{ weightGrams: 2100, lengthMm: 300, widthMm: 200, heightMm: 150 }];

beforeEach(async () => {
  await resetDb();
  await seedCatalog();
  setCarriers(null);
});
afterAll(() => setCarriers(null));

describe("carrier fulfilment", () => {
  it("says so when no carrier is connected, and books nothing", async () => {
    const admins = await as("ADMINISTRATOR");
    await admin.saveSetting(admins, "shipping", ORIGIN);
    const orderId = await paidOrder();
    setCarriers([]);
    await refused(bookLabel(admins, orderId, { carrier: "dhl", service: "P", boxes: BOX }), /DHL Express is not connected/);
    expect(await db.shipment.count()).toBe(0);
    const board = await fulfilmentBoard(admins);
    expect(board.carriers).toEqual([]);
    expect(board.waiting).toMatchObject([{ units: 2, weightGrams: 1900, needsCustoms: false }]);
  });

  it("will not book until the sender address is complete", async () => {
    const staff = await as("STAFF");
    const orderId = await paidOrder();
    setCarriers([testCarrier().carrier]);
    await refused(compareRates(staff, orderId, BOX), /sender address is incomplete/);
    await refused(bookLabel(staff, orderId, { carrier: "testcarrier", service: "STD", boxes: BOX }), /sender address is incomplete/);
  });

  it("compares rates cheapest first, suggests by the configured rule, and survives one carrier failing", async () => {
    const admins = await as("ADMINISTRATOR");
    await admin.saveSetting(admins, "shipping", ORIGIN);
    const orderId = await paidOrder();
    const broken = testCarrier({ key: "broken", name: "Broken Carrier", rates: async () => Promise.reject(new CarrierError("Broken Carrier", "service unavailable")) }).carrier;
    const noRates = testCarrier({ key: "contract", name: "Contract Carrier", rates: null }).carrier;
    setCarriers([testCarrier().carrier, broken, noRates]);

    const result = await compareRates(admins, orderId, BOX);
    expect(result.quotes.map((quote) => [quote.service, quote.priceCents, quote.suggested])).toEqual([["STD", 900, true], ["EXP", 2500, false]]);
    expect(result.problems).toEqual([{ carrier: "Broken Carrier", message: "Broken Carrier: service unavailable" }]);
    expect(result.withoutRates).toMatchObject([{ carrier: "contract", services: [{ code: "STD" }] }]);

    await admin.saveSetting(admins, "shipping", { ...ORIGIN, carrierRule: "fastest" });
    expect((await compareRates(admins, orderId, BOX)).quotes.find((quote) => quote.suggested)?.service).toBe("EXP");
    await refused(compareRates(admins, orderId, [{ weightGrams: 0 }]), /weight of each box/);
  });

  it("books a label, stores exactly what the carrier returned, and tells the customer", async () => {
    const admins = await as("ADMINISTRATOR");
    await admin.saveSetting(admins, "shipping", ORIGIN);
    const orderId = await paidOrder();
    const { carrier, seen } = testCarrier();
    setCarriers([carrier]);

    const shipmentId = await bookLabel(admins, orderId, { carrier: "testcarrier", service: "STD", boxes: [...BOX, ...BOX] });
    expect(seen.booked[0]).toMatchObject({ service: "STD", request: { sender: { name: "Azzopardi", city: "Brussels" }, recipient: { name: "Ada Buyer", countryCode: "BE" }, customs: false, declaredValueCents: 3600, boxes: [{ weightGrams: 2100 }, { weightGrams: 2100 }] } });
    expect(seen.booked[0].request.reference).toMatch(/^AZZ-\d+-1$/);

    const order = await admin.getOrder(admins, orderId);
    expect(order).toMatchObject({ status: "SHIPPED", fulfilmentStatus: "SHIPPED" });
    expect(order.shipments[0]).toMatchObject({ id: shipmentId, carrier: "Test Carrier", service: "Standard", source: "carrier", status: "LABEL_CREATED", carrierRef: "ref-1", trackingNumber: "TRK1", costCents: 900 });
    expect(order.shipments[0].parcels.map((parcel) => parcel.trackingNumber)).toEqual(["TRK1-1", "TRK1-2"]);
    expect(order.messages).toMatchObject([{ kind: "notify.customer.shipped" }]);

    const label = await getLabel(admins, shipmentId, 0);
    expect([label.mime, Buffer.from(label.data).toString()]).toEqual(["application/pdf", "%PDF label"]);
    await refused(getLabel(admins, shipmentId, 5), /Label not found/);
    await refused(bookLabel(admins, orderId, { carrier: "testcarrier", service: "STD", boxes: BOX }), /already been shipped/);
    expect(seen.booked).toHaveLength(1); // the carrier was not called for the refused second booking
  });

  it("records nothing when the carrier refuses", async () => {
    const admins = await as("ADMINISTRATOR");
    await admin.saveSetting(admins, "shipping", ORIGIN);
    const orderId = await paidOrder();
    setCarriers([testCarrier({ book: async () => Promise.reject(new CarrierError("Test Carrier", "Invalid postal code", 422)) }).carrier]);
    await refused(bookLabel(admins, orderId, { carrier: "testcarrier", service: "STD", boxes: BOX }), /Test Carrier: Invalid postal code Nothing was booked/);
    expect(await db.shipment.count()).toBe(0);
    expect(await db.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ fulfilmentStatus: "UNFULFILLED", status: "PAID" });
    expect(await db.auditLog.count({ where: { action: "shipment.book_failed" } })).toBe(1);
    expect(await db.shipmentAttempt.findFirstOrThrow()).toMatchObject({ status: "FAILED" });
    expect(await db.outboxJob.findFirstOrThrow()).toMatchObject({ kind: "notify.owner.label_failed" });

    // A clear refusal leaves the order free to be booked again.
    const { carrier, seen } = testCarrier();
    setCarriers([carrier]);
    await bookLabel(admins, orderId, { carrier: "testcarrier", service: "STD", boxes: BOX });
    expect(seen.booked).toHaveLength(1);
  });

  it("never books the same parcel twice: not on a double click, and not when the carrier fails to answer", async () => {
    const admins = await as("ADMINISTRATOR");
    await admin.saveSetting(admins, "shipping", ORIGIN);
    const orderId = await paidOrder();

    // Two requests at the same moment: one books, the other is refused before the carrier is called.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = testCarrier();
    const book = slow.carrier.book;
    slow.carrier.book = async (request, service) => {
      await gate;
      return book(request, service);
    };
    setCarriers([slow.carrier]);
    const first = bookLabel(admins, orderId, { carrier: "testcarrier", service: "STD", boxes: BOX });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await refused(bookLabel(admins, orderId, { carrier: "testcarrier", service: "STD", boxes: BOX }), /already being booked/);
    release();
    await first;
    expect(slow.seen.booked).toHaveLength(1);
    expect(await db.shipment.count()).toBe(1);

    // The carrier never answers: the outcome is unknown, so a retry is blocked until someone has checked.
    const other = await paidOrder();
    const silent = testCarrier({ book: async () => Promise.reject(new CarrierError("Test Carrier", "could not be reached (timeout).")) });
    setCarriers([silent.carrier]);
    await refused(bookLabel(admins, other, { carrier: "testcarrier", service: "STD", boxes: BOX }), /not known whether Test Carrier booked/);
    const working = testCarrier();
    setCarriers([working.carrier]);
    await refused(bookLabel(admins, other, { carrier: "testcarrier", service: "STD", boxes: BOX }), /may have gone through/);
    expect(working.seen.booked).toHaveLength(0);

    const [attempt] = await openAttempts(admins, other);
    expect(attempt).toMatchObject({ status: "UNKNOWN", carrier: "Test Carrier" });
    await refused(releaseAttempt(await as("STAFF"), attempt.id), /role does not allow/);
    await releaseAttempt(admins, attempt.id);
    await bookLabel(admins, other, { carrier: "testcarrier", service: "STD", boxes: BOX });
    expect(working.seen.booked).toHaveLength(1);
    await refused(releaseAttempt(admins, attempt.id), /not waiting/);
  });

  it("books labels for many orders, weighing each box and reporting the ones that fail", async () => {
    const admins = await as("ADMINISTRATOR");
    await admin.saveSetting(admins, "shipping", { ...ORIGIN, packagingGrams: 400, labelFormat: "A4" });
    const a = await paidOrder();
    const b = await paidOrder();
    const abroad = await paidOrder("GB"); // no customs code on its line: must be refused, not guessed
    const { carrier, seen } = testCarrier();
    setCarriers([carrier]);

    const result = await bulkBookLabels(admins, [a, b, abroad, a], { carrier: "testcarrier", service: "STD" });
    expect(result.booked).toHaveLength(2);
    expect(result.failed).toMatchObject([{ reason: expect.stringMatching(/customs/) }]);
    expect(seen.booked.map((call) => [call.request.boxes, call.request.labelFormat])).toEqual([[[{ weightGrams: 2300 }], "A4"], [[{ weightGrams: 2300 }], "A4"]]);
    expect(await db.order.count({ where: { fulfilmentStatus: "SHIPPED" } })).toBe(2);

    // Running the same batch again books nothing more.
    const again = await bulkBookLabels(admins, [a, b], { carrier: "testcarrier", service: "STD" });
    expect(again.booked).toHaveLength(0);
    expect(seen.booked).toHaveLength(2);
    await refused(bulkBookLabels(admins, [], { carrier: "testcarrier", service: "STD" }), /at least one order/);
  });

  it("requires a customs code for every product before booking outside the EU", async () => {
    const admins = await as("ADMINISTRATOR");
    await admin.saveSetting(admins, "shipping", ORIGIN);
    const { carrier, seen } = testCarrier();
    setCarriers([carrier]);
    await refused(bookLabel(admins, await paidOrder("GB"), { carrier: "testcarrier", service: "STD", boxes: BOX }), /customs \(HS\) code/);
    expect(seen.booked).toHaveLength(0);

    await bookLabel(admins, await paidOrder("GB", "150920"), { carrier: "testcarrier", service: "STD", boxes: BOX });
    expect(seen.booked[0].request).toMatchObject({ customs: true, commodities: [{ hsCode: "150920", originCountry: "IT", quantity: 2, unitValueCents: 1800 }] });
  });

  it("cancels a booking with the carrier and returns its units to be shipped", async () => {
    const manager = await as("MANAGER");
    const admins = await as("ADMINISTRATOR");
    await admin.saveSetting(admins, "shipping", ORIGIN);
    const orderId = await paidOrder();
    const { carrier, seen } = testCarrier();
    setCarriers([carrier]);
    const shipmentId = await bookLabel(manager, orderId, { carrier: "testcarrier", service: "STD", boxes: BOX });

    expect(await cancelBooking(manager, shipmentId)).toEqual({ cancelledWithCarrier: true });
    expect(seen.cancelled).toEqual(["ref-1"]);
    const order = await admin.getOrder(manager, orderId);
    expect(order).toMatchObject({ fulfilmentStatus: "READY", status: "READY_FOR_FULFILMENT" });
    expect(order.items[0].shippedQuantity).toBe(0);
    expect(order.shipments[0]).toMatchObject({ status: "CANCELLED" });
    await refused(cancelBooking(manager, shipmentId), /not open/);

    // The units can be booked again, under a new reference.
    await bookLabel(manager, orderId, { carrier: "testcarrier", service: "STD", boxes: BOX });
    expect(seen.booked[1].request.reference).toMatch(/-2$/);
  });

  it("follows tracking and marks the order delivered only when the carrier says so", async () => {
    const admins = await as("ADMINISTRATOR");
    await admin.saveSetting(admins, "shipping", ORIGIN);
    const orderId = await paidOrder();
    const { carrier, seen } = testCarrier();
    setCarriers([carrier]);
    const shipmentId = await bookLabel(admins, orderId, { carrier: "testcarrier", service: "STD", boxes: BOX });

    expect(await refreshTracking(db)).toEqual({ checked: 1, delivered: 0 });
    expect(await db.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).toMatchObject({ status: "IN_TRANSIT", trackingEvents: [{ description: "Picked up", location: "Brussels" }] });
    expect(await refreshTracking(db)).toEqual({ checked: 0, delivered: 0 }); // checked moments ago: not asked again yet

    seen.tracking = { status: "DELIVERED", deliveredAt: new Date("2026-11-17T10:00:00Z"), events: [...seen.tracking.events, { at: new Date("2026-11-17T10:00:00Z"), description: "Delivered" }] };
    expect(await refreshTracking(db, new Date(Date.now() + 3 * 3600_000))).toEqual({ checked: 1, delivered: 1 });
    const order = await admin.getOrder(admins, orderId);
    expect(order).toMatchObject({ status: "DELIVERED", fulfilmentStatus: "DELIVERED" });
    expect(order.shipments[0]).toMatchObject({ status: "DELIVERED", deliveredAt: new Date("2026-11-17T10:00:00Z") });
    expect(order.events.at(-1)).toMatchObject({ kind: "delivered", message: "Delivered, according to Test Carrier." });
    await refused(cancelBooking(admins, shipmentId), /already has this parcel/);
  });
});
