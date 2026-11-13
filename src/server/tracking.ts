import { createHash } from "node:crypto";
import { z } from "zod";
import type { Shipment } from "@/generated/prisma/client";
import { requireAdmin } from "./auth";
import type { Ctx } from "./context";
import type { Tx } from "./db";
import { AppError, parse } from "./errors";
import { syncOrderStatus } from "./orderStatus";
import { CarrierError, type Tracking, type TrackingEventKind } from "./shipping/carriers";
import { getCarrier } from "./shipping/registry";

/**
 * Where a parcel is, and whether something is wrong with it.
 *
 * Events come from two places and are stored the same way: read from the
 * carrier's API for a booked label, or typed by staff for a shipment recorded
 * by hand. Nothing here is invented: with no carrier connected and nothing
 * typed, a shipment has no events and the customer is told only that it was
 * sent, with its tracking number if there is one.
 *
 * A "problem" is what the carrier reports as wrong right now (an address
 * query, a refused parcel, a customs hold). It raises a flag on the shipment,
 * a line on the order's staff timeline and an alert to the shop. It is not
 * sent to the customer automatically: many resolve themselves within hours,
 * and the ones that do not need a person to write.
 */

export const EVENT_KINDS: TrackingEventKind[] = ["INFO", "OUT_FOR_DELIVERY", "EXCEPTION", "DELIVERED", "RETURNED"];
export const EVENT_KIND_LABEL: Record<TrackingEventKind, string> = { INFO: "On its way", OUT_FOR_DELIVERY: "Out for delivery", EXCEPTION: "Problem", DELIVERED: "Delivered", RETURNED: "Returned to us" };

type Parcel = Pick<Shipment, "id" | "orderId" | "carrier" | "status" | "exceptionAt" | "exceptionNote" | "trackingNumber">;

const alertKey = (shipmentId: string, text: string) => `notify.owner.alert:delivery:${shipmentId}:${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;

/** The order is delivered once every unit has left and none of its parcels is still travelling. */
async function rollUpDelivery(tx: Tx, parcel: Parcel, by: string) {
  const open = await tx.shipment.count({ where: { orderId: parcel.orderId, cancelledAt: null, status: { notIn: ["DELIVERED", "CANCELLED"] } } });
  if (open > 0) return;
  const moved = await tx.order.updateMany({ where: { id: parcel.orderId, fulfilmentStatus: "SHIPPED", cancelledAt: null }, data: { fulfilmentStatus: "DELIVERED" } });
  if (moved.count !== 1) return;
  await syncOrderStatus(tx, parcel.orderId);
  await tx.orderEvent.create({ data: { orderId: parcel.orderId, kind: "delivered", message: `Delivered, according to ${by}.` } });
}

async function raiseProblem(tx: Tx, parcel: Parcel, note: string, now: Date, alert: boolean) {
  if (parcel.exceptionAt && parcel.exceptionNote === note) return;
  await tx.shipment.update({ where: { id: parcel.id }, data: { exceptionAt: parcel.exceptionAt ?? now, exceptionNote: note } });
  const order = await tx.order.findUnique({ where: { id: parcel.orderId }, select: { number: true } });
  await tx.orderEvent.create({ data: { orderId: parcel.orderId, kind: "delivery_problem", isInternal: true, message: `${parcel.carrier} reports a problem with parcel ${parcel.trackingNumber ?? "(no tracking number)"}: ${note}` } });
  if (!alert) return;
  await tx.outboxJob.createMany({
    data: [{ kind: "notify.owner.alert", dedupeKey: alertKey(parcel.id, note), payload: { orderId: parcel.orderId, subject: "A parcel has a delivery problem", lines: [`${parcel.carrier} reports a problem with parcel ${parcel.trackingNumber ?? "(no tracking number)"} of order ${order?.number ?? ""}:`, note, "The customer has not been told. Check with the carrier and write to the customer if it does not resolve."] } }],
    skipDuplicates: true,
  });
}

async function clearProblem(tx: Tx, parcel: Parcel) {
  if (!parcel.exceptionAt) return;
  await tx.shipment.update({ where: { id: parcel.id }, data: { exceptionAt: null, exceptionNote: null } });
  await tx.orderEvent.create({ data: { orderId: parcel.orderId, kind: "delivery_problem_cleared", isInternal: true, message: `Parcel ${parcel.trackingNumber ?? ""} is moving again: the problem reported by ${parcel.carrier} is over.`.replace("  ", " ") } });
}

/**
 * Stores what a carrier answered for one parcel and acts on it: new events,
 * the parcel's status, a delivery problem raised or cleared, and the order
 * marked delivered when its last parcel arrives. Safe to apply the same
 * answer twice.
 */
export async function applyTracking(tx: Tx, parcel: Parcel, tracking: Tracking, now: Date): Promise<{ delivered: boolean; problem: boolean }> {
  if (tracking.events.length) {
    await tx.trackingEvent.createMany({
      data: tracking.events.map((event) => ({ shipmentId: parcel.id, occurredAt: event.at, description: event.description.slice(0, 500), location: event.location ?? null, code: event.code ?? null, kind: event.kind ?? "INFO", source: "carrier" })),
      skipDuplicates: true,
    });
  }
  const status = tracking.status ?? parcel.status;
  const becameDelivered = status === "DELIVERED" && parcel.status !== "DELIVERED";
  await tx.shipment.update({ where: { id: parcel.id }, data: { trackingCheckedAt: now, status, deliveredAt: status === "DELIVERED" ? (tracking.deliveredAt ?? now) : null } });

  // FAILED and RETURNED are final problems; an exception may pass.
  const last = tracking.events.at(-1)?.description;
  const problem = tracking.problem ?? (status === "FAILED" ? (last ?? "The carrier reports that delivery failed.") : status === "RETURNED" ? (last ?? "The parcel is being returned to the sender.") : null);
  if (problem && status !== "DELIVERED") await raiseProblem(tx, parcel, problem.slice(0, 500), now, true);
  else await clearProblem(tx, parcel);

  if (becameDelivered) await rollUpDelivery(tx, { ...parcel, status }, parcel.carrier);
  return { delivered: becameDelivered, problem: !!problem && status !== "DELIVERED" };
}

// ───────────────────────────── By hand ─────────────────────────────

const eventInput = z.object({
  kind: z.enum(["INFO", "OUT_FOR_DELIVERY", "EXCEPTION", "DELIVERED", "RETURNED"]),
  description: z.string().trim().min(3, "Say what happened in a few words.").max(300),
  location: z.string().trim().max(120).nullish().transform((value) => value || null),
  /** "2026-11-16T14:30" from a datetime-local field; empty means now. */
  occurredAt: z.string().trim().nullish(),
});

/**
 * Records a tracking event staff learned some other way: from the carrier's
 * website, a phone call, the customer. This is the fallback for shipments
 * recorded by hand and for when a carrier's API is unreachable. It is stored
 * as typed by a named person, never presented as the carrier's own data.
 */
export async function addTrackingEvent(ctx: Ctx, shipmentId: string, input: unknown): Promise<string> {
  const admin = requireAdmin(ctx, "STAFF", "shipping");
  const data = parse(eventInput, input);
  const now = new Date();
  const occurredAt = data.occurredAt ? new Date(data.occurredAt) : now;
  if (Number.isNaN(occurredAt.getTime())) throw new AppError("BAD_INPUT", "Enter the date and time, or leave them empty for now.", "occurredAt");
  if (occurredAt.getTime() > now.getTime() + 5 * 60_000) throw new AppError("BAD_INPUT", "That time is in the future.", "occurredAt");

  const orderId = await ctx.db.$transaction(async (tx) => {
    const parcel = await tx.shipment.findUnique({ where: { id: shipmentId } });
    if (!parcel || parcel.cancelledAt) throw new AppError("NOT_FOUND", "Shipment not found.");
    if (occurredAt < (parcel.shippedAt ?? parcel.createdAt)) throw new AppError("BAD_INPUT", "That is before the parcel was sent.", "occurredAt");
    if (parcel.status === "DELIVERED" && data.kind !== "DELIVERED") throw new AppError("BAD_INPUT", "This parcel is already recorded as delivered.");
    await tx.trackingEvent.createMany({ data: [{ shipmentId, occurredAt, description: data.description, location: data.location, kind: data.kind, source: "manual", adminUserId: admin.id }], skipDuplicates: true });

    if (data.kind === "DELIVERED") {
      await tx.shipment.update({ where: { id: shipmentId }, data: { status: "DELIVERED", deliveredAt: occurredAt } });
      await clearProblem(tx, parcel);
      if (parcel.status !== "DELIVERED") await rollUpDelivery(tx, { ...parcel, status: "DELIVERED" }, admin.name);
    } else if (data.kind === "RETURNED") {
      await tx.shipment.update({ where: { id: shipmentId }, data: { status: "RETURNED" } });
      await raiseProblem(tx, parcel, data.description, now, false);
    } else if (data.kind === "EXCEPTION") {
      // The person typing this already knows; no alert is sent back to the shop.
      await raiseProblem(tx, parcel, data.description, now, false);
    } else {
      if (parcel.status === "LABEL_CREATED" || parcel.status === "PENDING") await tx.shipment.update({ where: { id: shipmentId }, data: { status: "IN_TRANSIT" } });
      if (parcel.exceptionAt && occurredAt >= parcel.exceptionAt) await clearProblem(tx, parcel);
    }
    return parcel.orderId;
  });
  await ctx.db.auditLog.create({ data: { actorType: "admin", actorId: admin.id, action: "shipment.tracking.manual", entity: "Order", entityId: orderId, data: { shipmentId, kind: data.kind, description: data.description }, ip: ctx.ip } });
  return orderId;
}

const numberInput = z.object({
  trackingNumber: z.string().trim().min(3, "Enter the tracking number.").max(80),
  trackingUrl: z.string().trim().url("Enter a full tracking link, starting with https://").max(500).nullish().or(z.literal("")).transform((value) => value || null),
});

/**
 * Adds or corrects the tracking number of a shipment recorded by hand. A
 * number issued by a carrier through its API is never edited: it is the
 * carrier's, and changing it would break tracking and cancellation.
 */
export async function setTrackingNumber(ctx: Ctx, shipmentId: string, input: unknown): Promise<string> {
  const admin = requireAdmin(ctx, "STAFF", "shipping");
  const data = parse(numberInput, input);
  const parcel = await ctx.db.shipment.findUnique({ where: { id: shipmentId } });
  if (!parcel || parcel.cancelledAt) throw new AppError("NOT_FOUND", "Shipment not found.");
  if (parcel.source === "carrier") throw new AppError("BAD_INPUT", "This number was issued by the carrier when the label was booked and cannot be changed.");
  await ctx.db.shipment.update({ where: { id: shipmentId }, data: { trackingNumber: data.trackingNumber, trackingUrl: data.trackingUrl } });
  await ctx.db.auditLog.create({ data: { actorType: "admin", actorId: admin.id, action: "shipment.tracking.number", entity: "Order", entityId: parcel.orderId, data: { shipmentId, from: parcel.trackingNumber, to: data.trackingNumber }, ip: ctx.ip } });
  return parcel.orderId;
}

// ───────────────────────────── What needs a person ─────────────────────────────

const DAY = 24 * 3600_000;
export const WATCH = { notCollectedDays: 2, silentDays: 4, longDays: 10 } as const;

/**
 * Parcels that need someone to look: a reported problem, a delivery date
 * that has passed, a label never collected, a parcel the carrier has said
 * nothing about for days, and shipments sent without a tracking number.
 * "Late" uses the carrier's own estimate where there is one; without it,
 * only a parcel on the road for more than ten days is called late.
 */
export async function shipmentWatchlist(ctx: Ctx, now = new Date()) {
  requireAdmin(ctx, "VIEW", "shipping");
  const open = await ctx.db.shipment.findMany({
    where: { cancelledAt: null, status: { in: ["PENDING", "LABEL_CREATED", "IN_TRANSIT", "FAILED", "RETURNED"] } },
    orderBy: { shippedAt: "asc" },
    take: 300,
    include: { order: { select: { id: true, number: true, shipFirstName: true, shipLastName: true, shipCountryCode: true } }, events: { orderBy: { occurredAt: "desc" }, take: 1 } },
  });
  const rows = open.map((shipment) => {
    const sent = shipment.shippedAt ?? shipment.createdAt;
    const lastEvent = shipment.events[0] ?? null;
    const travelling = shipment.status === "IN_TRANSIT" || shipment.status === "LABEL_CREATED" || shipment.status === "PENDING";
    const reasons: string[] = [];
    if (shipment.exceptionAt || shipment.status === "FAILED" || shipment.status === "RETURNED") reasons.push(shipment.exceptionNote ?? (shipment.status === "RETURNED" ? "Returned to sender" : "Delivery problem"));
    if (travelling && shipment.estimatedDeliveryAt && shipment.estimatedDeliveryAt.getTime() + DAY < now.getTime()) reasons.push("Past the carrier's delivery estimate");
    else if (travelling && now.getTime() - sent.getTime() > WATCH.longDays * DAY) reasons.push(`Sent more than ${WATCH.longDays} days ago and not delivered`);
    if (shipment.status === "LABEL_CREATED" && now.getTime() - sent.getTime() > WATCH.notCollectedDays * DAY) reasons.push("Label booked but not collected by the carrier");
    if (shipment.source === "carrier" && shipment.status === "IN_TRANSIT" && shipment.trackingCheckedAt && now.getTime() - (lastEvent?.occurredAt ?? sent).getTime() > WATCH.silentDays * DAY) reasons.push(`No tracking update for more than ${WATCH.silentDays} days`);
    if (travelling && !shipment.trackingNumber) reasons.push("No tracking number recorded");
    return { id: shipment.id, orderId: shipment.order.id, number: shipment.order.number, customer: `${shipment.order.shipFirstName} ${shipment.order.shipLastName}`, country: shipment.order.shipCountryCode, carrier: shipment.carrier, trackingNumber: shipment.trackingNumber, status: shipment.status, sentAt: sent, estimatedDeliveryAt: shipment.estimatedDeliveryAt, lastEvent: lastEvent ? { at: lastEvent.occurredAt, description: lastEvent.description } : null, problem: !!shipment.exceptionAt || shipment.status === "FAILED" || shipment.status === "RETURNED", reasons };
  });
  const attention = rows.filter((row) => row.reasons.length > 0);
  return {
    attention,
    inTransit: rows.filter((row) => row.status === "IN_TRANSIT").length,
    awaitingCollection: rows.filter((row) => row.status === "LABEL_CREATED" || row.status === "PENDING").length,
    problems: attention.filter((row) => row.problem).length,
    late: attention.filter((row) => row.reasons.some((reason) => reason.startsWith("Past") || reason.startsWith("Sent more"))).length,
    withoutTracking: attention.filter((row) => row.reasons.includes("No tracking number recorded")).length,
  };
}

/**
 * Proves a carrier's credentials work, without booking or tracking anything.
 * The result is the carrier's own answer. Only carriers with a harmless call
 * to make can be tested this way.
 */
export async function testCarrier(ctx: Ctx, key: string): Promise<string> {
  requireAdmin(ctx, "ADMINISTRATOR", "integrations");
  let carrier;
  try {
    carrier = getCarrier(key);
  } catch (error) {
    throw new AppError("BAD_INPUT", error instanceof Error ? error.message : "That carrier is not connected.");
  }
  if (!carrier.ping) throw new AppError("BAD_INPUT", `${carrier.name} offers no call that tests the credentials without booking a shipment. Book one label in its test environment instead.`);
  try {
    await carrier.ping();
  } catch (error) {
    await ctx.db.auditLog.create({ data: { actorType: "admin", actorId: ctx.admin?.id ?? null, action: "integration.test", entity: "Carrier", entityId: key, data: { ok: false }, ip: ctx.ip } });
    throw new AppError("BAD_INPUT", error instanceof CarrierError ? `The test did not succeed. ${error.message}` : `The test did not succeed: ${carrier.name} could not be reached.`);
  }
  await ctx.db.auditLog.create({ data: { actorType: "admin", actorId: ctx.admin?.id ?? null, action: "integration.test", entity: "Carrier", entityId: key, data: { ok: true, environment: carrier.environment }, ip: ctx.ip } });
  return `${carrier.name} accepted the credentials (${carrier.environment} environment). This proves sign-in only: book a test label to prove the rest.`;
}
