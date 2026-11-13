import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminRole } from "@/generated/prisma/client";
import * as admin from "@/server/admin";
import type { Ctx } from "@/server/context";
import { createServer } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";
import { bookLabel, refreshTracking } from "@/server/fulfilment";
import { CarrierError, type ShippingCarrier, type Tracking } from "@/server/shipping/carriers";
import { setCarriers } from "@/server/shipping/registry";
import { addTrackingEvent, setTrackingNumber, shipmentWatchlist, testCarrier } from "@/server/tracking";
import { BILL, createClient, db, resetDb, seedCatalog } from "../helpers";

const server = createServer(storefrontSchema);

async function as(role: AdminRole): Promise<Ctx> {
  const user = await db.adminUser.create({ data: { email: `${role}-${Math.random().toString(36).slice(2)}@test.local`, name: `${role} person`, role, passwordHash: "x" } });
  return { db, ip: "10.9.9.9", userAgent: null, cookies: {}, setCookies: [], customer: null, admin: user };
}
const refused = async (promise: Promise<unknown>, expected: string) => expect(await promise.then(() => "resolved", (error: { code?: string }) => error.code)).toBe(expected);

async function paidOrder() {
  const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
  const order = await db.order.create({
    data: {
      ...BILL,
      shipFirstName: "Ada",
      shipLastName: "Buyer",
      shipLine1: "Hoofdstraat 5",
      shipPostalCode: "2000",
      shipCity: "Antwerp",
      shipCountryCode: "BE",
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
      items: { create: [{ variantId: variant.id, sku: "t-500", productName: "Test Oil", variantLabel: "500 ml", unitPriceCents: 1800, quantity: 2, lineTotalCents: 3600, weightGrams: 950 }] },
    },
  });
  return order;
}

/** A stand-in carrier that answers tracking with whatever the test sets. Never registered outside tests. */
function scripted() {
  const state: { tracking: Tracking | Error; pinged: number } = { tracking: { status: null, deliveredAt: null, events: [] }, pinged: 0 };
  const carrier: ShippingCarrier = {
    key: "testcarrier",
    name: "Test Carrier",
    requires: [],
    environment: "test",
    services: [{ code: "STD", name: "Standard" }],
    rates: null,
    book: async () => ({ carrierRef: "ref-1", trackingNumber: "TRK1", trackingUrl: "https://track.example/TRK1", boxTrackingNumbers: ["TRK1"], labels: [{ mime: "application/pdf", data: Buffer.from("%PDF label") }], costCents: 900, estimatedDelivery: new Date("2026-11-17T12:00:00Z") }),
    cancel: null,
    track: async () => {
      if (state.tracking instanceof Error) throw state.tracking;
      return state.tracking;
    },
    ping: async () => {
      state.pinged += 1;
    },
  };
  return { carrier, state };
}

const BOX = [{ weightGrams: 2000 }];
const at = (iso: string) => new Date(iso);
const later = (hours: number) => new Date(Date.now() + hours * 3600_000);
const jobs = async () => (await db.outboxJob.findMany({ where: { kind: "notify.owner.alert" } })).length;
const internal = async (orderId: string) => (await db.orderEvent.findMany({ where: { orderId, isInternal: true, kind: { startsWith: "delivery_problem" } }, orderBy: { createdAt: "asc" } })).map((event) => event.kind);

let boss: Ctx;
let packer: Ctx;

beforeEach(async () => {
  await resetDb();
  await seedCatalog();
  await db.setting.create({ data: { key: "shipping", value: { senderName: "Azzopardi", senderLine1: "Olijfstraat 12", senderPostalCode: "1000", senderCity: "Brussels", senderCountryCode: "BE", senderPhone: "+3221234567" } } });
  boss = await as("ADMINISTRATOR");
  packer = await as("STAFF");
});
afterAll(() => setCarriers(null));

describe("tracking read from a carrier", () => {
  it("stores each event once, raises a problem, clears it, and delivers the order", async () => {
    const { carrier, state } = scripted();
    setCarriers([carrier]);
    const order = await paidOrder();
    const shipmentId = await bookLabel(boss, order.id, { carrier: "testcarrier", service: "STD", boxes: BOX });
    await db.outboxJob.deleteMany();
    const parcel = () => db.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { events: { orderBy: { occurredAt: "asc" } } } });

    const picked = { at: at("2026-11-13T18:00:00Z"), description: "Picked up", location: "Brussels", code: "P" };
    state.tracking = { status: "IN_TRANSIT", deliveredAt: null, events: [picked] };
    expect(await refreshTracking(db, later(0))).toEqual({ checked: 1, delivered: 0 });
    // The carrier always sends its whole history; asking again must not double it.
    expect(await refreshTracking(db, later(3))).toEqual({ checked: 1, delivered: 0 });
    expect((await parcel()).events.map((event) => [event.description, event.source, event.code])).toEqual([["Picked up", "carrier", "P"]]);
    expect((await parcel()).exceptionAt).toBeNull();

    // The carrier reports a problem: staff are alerted once, the customer is not written to.
    const failed = { at: at("2026-11-14T10:00:00Z"), description: "Receiver not available", kind: "EXCEPTION" as const };
    state.tracking = { status: "IN_TRANSIT", deliveredAt: null, events: [picked, failed], problem: "Receiver not available. A second attempt will be made." };
    await refreshTracking(db, later(6));
    await refreshTracking(db, later(9)); // the same problem again: no second alert
    expect(await parcel()).toMatchObject({ status: "IN_TRANSIT", exceptionNote: "Receiver not available. A second attempt will be made." });
    expect(await jobs()).toBe(1);
    expect(await internal(order.id)).toEqual(["delivery_problem"]);
    expect(await db.outboxJob.count({ where: { kind: { startsWith: "notify.customer" } } })).toBe(0);
    expect((await shipmentWatchlist(packer)).attention).toMatchObject([{ number: order.number, problem: true, reasons: ["Receiver not available. A second attempt will be made."] }]);
    expect(await admin.dashboard(boss)).toMatchObject({ parcelsInTransit: 1, parcelProblems: 1 });

    // It moves again: the flag clears by itself.
    const out = { at: at("2026-11-15T07:00:00Z"), description: "Out for delivery", kind: "OUT_FOR_DELIVERY" as const };
    state.tracking = { status: "IN_TRANSIT", deliveredAt: null, events: [picked, failed, out], problem: null };
    await refreshTracking(db, later(12));
    expect((await parcel()).exceptionAt).toBeNull();
    expect(await internal(order.id)).toEqual(["delivery_problem", "delivery_problem_cleared"]);
    expect((await shipmentWatchlist(packer)).attention).toEqual([]);

    // Delivered: the parcel, then the order, since it was the last parcel.
    state.tracking = { status: "DELIVERED", deliveredAt: at("2026-11-15T11:30:00Z"), events: [picked, failed, out, { at: at("2026-11-15T11:30:00Z"), description: "Delivered", kind: "DELIVERED" as const }] };
    expect(await refreshTracking(db, later(15))).toEqual({ checked: 1, delivered: 1 });
    expect(await parcel()).toMatchObject({ status: "DELIVERED", deliveredAt: at("2026-11-15T11:30:00Z"), exceptionAt: null });
    expect((await parcel()).events.map((event) => event.kind)).toEqual(["INFO", "EXCEPTION", "OUT_FOR_DELIVERY", "DELIVERED"]);
    expect(await admin.getOrder(boss, order.id)).toMatchObject({ status: "DELIVERED", fulfilmentStatus: "DELIVERED" });
    expect(await refreshTracking(db, later(30))).toEqual({ checked: 0, delivered: 0 }); // a delivered parcel is not asked about again
  });

  it("treats a failed or returned parcel as a problem, and survives a carrier that does not answer", async () => {
    const { carrier, state } = scripted();
    setCarriers([carrier]);
    const order = await paidOrder();
    const shipmentId = await bookLabel(boss, order.id, { carrier: "testcarrier", service: "STD", boxes: BOX });
    await db.outboxJob.deleteMany();

    state.tracking = new CarrierError("Test Carrier", "could not be reached");
    expect(await refreshTracking(db, later(0))).toEqual({ checked: 0, delivered: 0 }); // tried again later; nothing changes
    expect(await db.trackingEvent.count()).toBe(0);

    state.tracking = { status: "RETURNED", deliveredAt: null, events: [{ at: at("2026-11-20T08:00:00Z"), description: "Returning to sender", kind: "RETURNED" }] };
    await refreshTracking(db, later(3));
    expect(await db.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).toMatchObject({ status: "RETURNED", exceptionNote: "Returning to sender" });
    expect(await jobs()).toBe(1);
    expect((await shipmentWatchlist(packer)).problems).toBe(1);
    expect((await admin.getOrder(boss, order.id)).fulfilmentStatus).toBe("SHIPPED"); // returned is not delivered
  });

  it("shows the customer the latest events, the carrier's own estimate and a problem, and nothing internal", async () => {
    const { carrier, state } = scripted();
    setCarriers([carrier]);
    const order = await paidOrder();
    await bookLabel(boss, order.id, { carrier: "testcarrier", service: "STD", boxes: BOX });
    state.tracking = { status: "IN_TRANSIT", deliveredAt: null, events: [{ at: at("2026-11-13T18:00:00Z"), description: "Picked up", location: "Brussels" }, { at: at("2026-11-14T10:00:00Z"), description: "Held at customs", kind: "EXCEPTION" }], problem: "Held at customs" };
    await refreshTracking(db, later(0));

    const seen = await createClient(server).gql<{ order: { shipments: { hasProblem: boolean; estimatedDeliveryAt: string | null; events: { description: string; location: string | null; kind: string }[] }[]; events: { kind: string }[] } }>(
      `query ($n: String!) { order(number: $n, email: "ada@example.com") { events { kind } shipments { hasProblem estimatedDeliveryAt events { description location kind } } } }`,
      { n: order.number },
    );
    expect(seen.data?.order.shipments).toEqual([{ hasProblem: true, estimatedDeliveryAt: "2026-11-17T12:00:00.000Z", events: [{ description: "Held at customs", location: null, kind: "EXCEPTION" }, { description: "Picked up", location: "Brussels", kind: "INFO" }] }]);
    expect(seen.data?.order.events.map((event) => event.kind)).not.toContain("delivery_problem"); // the staff note stays with staff
  });
});

describe("tracking recorded by hand", () => {
  it("lets staff add a number and events to a shipment sent without a carrier connection", async () => {
    const order = await paidOrder();
    const shipmentId = await admin.createShipment(packer, order.id, { carrier: "bpost" });
    expect((await shipmentWatchlist(packer)).attention).toMatchObject([{ reasons: ["No tracking number recorded"] }]);

    await refused(setTrackingNumber(packer, shipmentId, { trackingNumber: "x" }), "BAD_INPUT");
    await refused(setTrackingNumber(packer, shipmentId, { trackingNumber: "3232000123", trackingUrl: "not a link" }), "BAD_INPUT");
    await setTrackingNumber(packer, shipmentId, { trackingNumber: "3232000123", trackingUrl: "https://track.bpost.cloud/btr/web/#/search?itemCode=3232000123" });
    expect((await shipmentWatchlist(packer)).attention).toEqual([]);

    await refused(addTrackingEvent(packer, shipmentId, { kind: "INFO", description: "ok" }), "BAD_INPUT"); // too short to mean anything
    await refused(addTrackingEvent(packer, shipmentId, { kind: "INFO", description: "Arrived at depot", occurredAt: "2999-01-01T10:00" }), "BAD_INPUT");
    await refused(addTrackingEvent(packer, shipmentId, { kind: "INFO", description: "Arrived at depot", occurredAt: "2001-01-01T10:00" }), "BAD_INPUT"); // before it was sent
    await refused(addTrackingEvent(packer, shipmentId, { kind: "TELEPORTED", description: "Arrived at depot" }), "BAD_INPUT");
    await refused(addTrackingEvent({ ...packer, admin: null }, shipmentId, { kind: "INFO", description: "Arrived at depot" }), "UNAUTHENTICATED");

    await addTrackingEvent(packer, shipmentId, { kind: "INFO", description: "Arrived at the Antwerp depot", location: "Antwerp" });
    await addTrackingEvent(packer, shipmentId, { kind: "EXCEPTION", description: "Customer not at home, card left" });
    expect(await db.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).toMatchObject({ status: "IN_TRANSIT", exceptionNote: "Customer not at home, card left" });
    expect(await jobs()).toBe(0); // the person who typed it already knows

    await addTrackingEvent(packer, shipmentId, { kind: "DELIVERED", description: "Handed to the customer" });
    const parcel = await db.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { events: { orderBy: { createdAt: "asc" } } } });
    expect(parcel).toMatchObject({ status: "DELIVERED", exceptionAt: null });
    expect(parcel.events.map((event) => [event.kind, event.source, event.adminUserId === packer.admin!.id])).toEqual([["INFO", "manual", true], ["EXCEPTION", "manual", true], ["DELIVERED", "manual", true]]);
    const finished = await admin.getOrder(boss, order.id);
    expect(finished).toMatchObject({ status: "DELIVERED" });
    expect(finished.events.at(-1)).toMatchObject({ kind: "delivered", message: "Delivered, according to STAFF person." }); // named as a person's word, not the carrier's
    await refused(addTrackingEvent(packer, shipmentId, { kind: "INFO", description: "Still travelling" }), "BAD_INPUT"); // already delivered
    expect((await db.auditLog.findMany({ where: { action: { startsWith: "shipment.tracking" } } })).length).toBe(4);
  });

  it("never lets a carrier-issued tracking number be edited", async () => {
    const { carrier } = scripted();
    setCarriers([carrier]);
    const order = await paidOrder();
    const shipmentId = await bookLabel(boss, order.id, { carrier: "testcarrier", service: "STD", boxes: BOX });
    await refused(setTrackingNumber(boss, shipmentId, { trackingNumber: "SOMETHING-ELSE" }), "BAD_INPUT");
    expect((await db.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).trackingNumber).toBe("TRK1");
  });
});

describe("parcels that need attention", () => {
  it("names late, uncollected, silent and unnumbered parcels, and nothing that is fine", async () => {
    const { carrier, state } = scripted();
    setCarriers([carrier]);
    const [fine, late, uncollected, silent] = [await paidOrder(), await paidOrder(), await paidOrder(), await paidOrder()];
    const ids: Record<string, string> = {};
    for (const [name, order] of [["fine", fine], ["late", late], ["uncollected", uncollected], ["silent", silent]] as const) ids[name] = await bookLabel(boss, order.id, { carrier: "testcarrier", service: "STD", boxes: BOX });

    const now = new Date("2026-12-01T12:00:00Z");
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
    await db.shipment.update({ where: { id: ids.fine }, data: { status: "IN_TRANSIT", shippedAt: days(1), estimatedDeliveryAt: new Date(now.getTime() + 86_400_000), trackingCheckedAt: now, events: { create: [{ occurredAt: days(0.5), description: "In transit" }] } } });
    await db.shipment.update({ where: { id: ids.late }, data: { status: "IN_TRANSIT", shippedAt: days(6), estimatedDeliveryAt: days(3), trackingCheckedAt: now, events: { create: [{ occurredAt: days(1), description: "In transit" }] } } });
    await db.shipment.update({ where: { id: ids.uncollected }, data: { status: "LABEL_CREATED", shippedAt: days(3), estimatedDeliveryAt: null } });
    await db.shipment.update({ where: { id: ids.silent }, data: { status: "IN_TRANSIT", shippedAt: days(6), estimatedDeliveryAt: null, trackingCheckedAt: now, events: { create: [{ occurredAt: days(5), description: "Departed facility" }] } } });

    const watch = await shipmentWatchlist(packer, now);
    const why = Object.fromEntries(watch.attention.map((row) => [row.number, row.reasons]));
    expect(why[fine.number!]).toBeUndefined();
    expect(why[late.number!]).toEqual(["Past the carrier's delivery estimate"]);
    expect(why[uncollected.number!]).toEqual(["Label booked but not collected by the carrier"]);
    expect(why[silent.number!]).toEqual(["No tracking update for more than 4 days"]);
    expect(watch).toMatchObject({ inTransit: 3, awaitingCollection: 1, problems: 0, late: 1, withoutTracking: 0 });
    await refused(shipmentWatchlist({ ...packer, admin: null }), "UNAUTHENTICATED");
    void state;
  });
});

describe("testing a carrier's credentials", () => {
  it("is for administrators, calls only the harmless sign-in, and reports the carrier's own refusal", async () => {
    const { carrier, state } = scripted();
    setCarriers([carrier]);
    await refused(testCarrier(packer, "testcarrier"), "FORBIDDEN");
    expect(await testCarrier(boss, "testcarrier")).toContain("Test Carrier accepted the credentials (test environment)");
    expect(state.pinged).toBe(1);
    expect(await db.shipment.count()).toBe(0); // nothing was booked

    setCarriers([{ ...carrier, ping: async () => Promise.reject(new CarrierError("Test Carrier", "10401: ClientId is Invalid", 401)) }]);
    const failure = await testCarrier(boss, "testcarrier").catch((error: Error) => error.message);
    expect(failure).toContain("Test Carrier: 10401: ClientId is Invalid");

    setCarriers([{ ...carrier, ping: undefined }]);
    await refused(testCarrier(boss, "testcarrier"), "BAD_INPUT"); // no harmless call exists for it
    await refused(testCarrier(boss, "nosuchcarrier"), "BAD_INPUT");
    expect((await db.auditLog.findMany({ where: { action: "integration.test" }, orderBy: { createdAt: "asc" } })).map((log) => (log.data as { ok: boolean }).ok)).toEqual([true, false]);
  });
});
