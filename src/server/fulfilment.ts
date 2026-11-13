import type { Order, OrderItem, Prisma } from "@/generated/prisma/client";
import { audit, createShipment, timeline } from "./admin";
import { requireAdmin } from "./auth";
import type { Ctx } from "./context";
import type { Db } from "./db";
import { AppError } from "./errors";
import { PAYMENT_ALLOWS_FULFILMENT, fulfilmentFromQuantities, syncOrderStatus } from "./orderStatus";
import { CarrierError, CarrierNotConnected, type Box, type Party, type RateQuote, type ShipmentRequest } from "./shipping/carriers";
import { carrierStates, connectedCarriers, getCarrier } from "./shipping/registry";

/**
 * Carrier fulfilment: live rates, booking a label, cancelling it, and
 * following its tracking. Everything shown to staff or customers here came
 * from a carrier's API; when a carrier is not connected the functions say so
 * and staff fall back to recording a shipment by hand.
 */

/** Members of the EU customs union: parcels between them need no customs declaration. */
const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "MC"]);

type ShippingSettings = { labelFormat?: "THERMAL" | "A4" } & Partial<Record<"senderName" | "senderCompany" | "senderLine1" | "senderLine2" | "senderPostalCode" | "senderCity" | "senderCountryCode" | "senderPhone" | "senderEmail", string | null>> & { carrierRule?: "manual" | "cheapest" | "fastest"; packagingGrams?: number };

export async function shippingSettings(db: Db): Promise<ShippingSettings> {
  return ((await db.setting.findUnique({ where: { key: "shipping" } }))?.value ?? {}) as ShippingSettings;
}

/** The sender address carriers need. Refuses to guess: a label with a wrong return address is worse than none. */
export function senderFrom(settings: ShippingSettings): Party {
  const missing = (["senderName", "senderLine1", "senderPostalCode", "senderCity", "senderCountryCode", "senderPhone"] as const).filter((key) => !settings[key]);
  if (missing.length) throw new AppError("BAD_INPUT", "The sender address is incomplete. Fill in name, street, postal code, city, country and phone under Settings → Shipping origin.");
  return { name: settings.senderName!, company: settings.senderCompany, line1: settings.senderLine1!, line2: settings.senderLine2, postalCode: settings.senderPostalCode!, city: settings.senderCity!, countryCode: settings.senderCountryCode!, phone: settings.senderPhone, email: settings.senderEmail };
}

type Line = { orderItemId: string; quantity: number };
type FullOrder = Order & { items: OrderItem[] };

function linesToShip(order: FullOrder, wanted?: Line[] | null): { item: OrderItem; quantity: number }[] {
  const lines = wanted?.filter((line) => line.quantity > 0) ?? order.items.map((item) => ({ orderItemId: item.id, quantity: item.quantity - item.shippedQuantity }));
  const result = lines
    .map((line) => ({ item: order.items.find((item) => item.id === line.orderItemId), quantity: line.quantity }))
    .filter((line): line is { item: OrderItem; quantity: number } => !!line.item && line.quantity > 0);
  for (const line of result) if (line.quantity > line.item.quantity - line.item.shippedQuantity) throw new AppError("BAD_INPUT", `${line.item.productName} ${line.item.variantLabel}: only ${line.item.quantity - line.item.shippedQuantity} left to ship.`);
  if (result.length === 0) throw new AppError("BAD_INPUT", "Everything on this order has already been shipped.");
  return result;
}

export function buildShipmentRequest(order: FullOrder, sender: Party, boxes: Box[], wanted: Line[] | null | undefined, reference: string, shipDate = new Date(), labelFormat: "THERMAL" | "A4" = "THERMAL"): ShipmentRequest {
  const lines = linesToShip(order, wanted);
  if (boxes.length === 0 || boxes.some((box) => !(box.weightGrams > 0))) throw new AppError("BAD_INPUT", "Enter the weight of each box.");
  const customs = !(EU.has(sender.countryCode) && EU.has(order.shipCountryCode));
  // Customs value is what the customer paid for the goods: the line total less its share of any discount.
  const goods = order.subtotalCents || 1;
  const commodities = lines.map(({ item, quantity }) => ({
    description: `${item.productName} ${item.variantLabel}`,
    quantity,
    unitValueCents: Math.round((item.unitPriceCents * (goods - order.discountCents)) / goods),
    unitWeightGrams: item.weightGrams,
    hsCode: item.hsCode,
    originCountry: item.originCountry,
  }));
  if (customs && commodities.some((line) => !line.hsCode)) throw new AppError("BAD_INPUT", `${order.shipCountryCode} is outside the EU, so every product needs a customs (HS) code. Add it under Products, then set it on this order's lines by placing the order again or ask for a manual shipment.`);
  return {
    reference,
    sender,
    recipient: { name: `${order.shipFirstName} ${order.shipLastName}`, company: null, line1: order.shipLine1, line2: order.shipLine2, postalCode: order.shipPostalCode, city: order.shipCity, region: order.shipRegion, countryCode: order.shipCountryCode, email: order.email, phone: order.shipPhone },
    boxes,
    commodities,
    currency: order.currency,
    declaredValueCents: commodities.reduce((sum, line) => sum + line.unitValueCents * line.quantity, 0),
    customs,
    shipDate,
    labelFormat,
  };
}

async function shippableOrder(ctx: Ctx, orderId: string): Promise<FullOrder> {
  const order = await ctx.db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  if (order.cancelledAt || !PAYMENT_ALLOWS_FULFILMENT.includes(order.paymentStatus)) throw new AppError("BAD_INPUT", "Only a paid order can be shipped.");
  return order;
}

export type RateComparison = { quotes: (RateQuote & { suggested: boolean })[]; problems: { carrier: string; message: string }[]; withoutRates: { carrier: string; carrierName: string; services: { code: string; name: string }[] }[]; rule: string };

/** Asks every connected carrier that has a rating API what this shipment would cost. One carrier failing never hides the others. */
export async function compareRates(ctx: Ctx, orderId: string, boxes: Box[], wanted?: Line[] | null): Promise<RateComparison> {
  requireAdmin(ctx, "STAFF", "shipping");
  const order = await shippableOrder(ctx, orderId);
  const settings = await shippingSettings(ctx.db);
  const request = buildShipmentRequest(order, senderFrom(settings), boxes, wanted, order.number ?? order.id, new Date(), settings.labelFormat ?? "THERMAL");
  const carriers = connectedCarriers();
  const quotes: RateQuote[] = [];
  const problems: RateComparison["problems"] = [];
  await Promise.all(
    carriers.map(async (carrier) => {
      if (!carrier.rates) return;
      try {
        quotes.push(...(await carrier.rates(request)));
      } catch (error) {
        if (!(error instanceof CarrierError)) throw error;
        problems.push({ carrier: carrier.name, message: error.message });
      }
    }),
  );
  quotes.sort((a, b) => a.priceCents - b.priceCents);
  const rule = settings.carrierRule ?? "manual";
  const pick = rule === "cheapest" ? quotes[0] : rule === "fastest" ? [...quotes].filter((quote) => quote.estimatedDelivery).sort((a, b) => a.estimatedDelivery!.getTime() - b.estimatedDelivery!.getTime())[0] : undefined;
  return {
    quotes: quotes.map((quote) => ({ ...quote, suggested: quote === pick })),
    problems,
    withoutRates: carriers.filter((carrier) => !carrier.rates).map((carrier) => ({ carrier: carrier.key, carrierName: carrier.name, services: carrier.services })),
    rule,
  };
}

/** The units an attempt covers, so the same units cannot be booked twice at once. */
function fingerprintOf(order: FullOrder, wanted?: Line[] | null): string {
  return linesToShip(order, wanted)
    .map((line) => `${line.item.id}:${line.quantity}`)
    .sort()
    .join("|");
}

/**
 * Books the shipment with the carrier, stores the label it returns, and
 * records the shipment.
 *
 * A label costs money, so it must never be bought twice. Before the carrier
 * is called, an attempt is written under a lock on the order: while one is
 * open for the same units, a second click, a browser retry or a second
 * person is refused. If the carrier refuses, the attempt is closed and
 * nothing is recorded. If the carrier never answers, whether it booked is
 * unknown: the attempt stays open and blocks a retry until someone has
 * checked with the carrier and released it.
 */
export async function bookLabel(ctx: Ctx, orderId: string, input: { carrier: string; service: string; boxes: Box[]; items?: Line[] | null }): Promise<string> {
  const admin = requireAdmin(ctx, "STAFF", "shipping");
  const order = await shippableOrder(ctx, orderId);
  let carrier;
  try {
    carrier = getCarrier(input.carrier);
  } catch (error) {
    throw error instanceof CarrierNotConnected ? new AppError("BAD_INPUT", error.message) : error;
  }
  if (!input.service) throw new AppError("BAD_INPUT", "Choose a service.");
  const settings = await shippingSettings(ctx.db);
  const previous = await ctx.db.shipment.count({ where: { orderId } });
  const request = buildShipmentRequest(order, senderFrom(settings), input.boxes, input.items, `${order.number ?? order.id}-${previous + 1}`, new Date(), settings.labelFormat ?? "THERMAL");
  const fingerprint = fingerprintOf(order, input.items);

  const attempt = await ctx.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const open = await tx.shipmentAttempt.findFirst({ where: { orderId, fingerprint, status: { in: ["STARTED", "UNKNOWN"] } } });
    if (open?.status === "UNKNOWN") throw new AppError("BAD_INPUT", `An earlier booking with ${open.carrier} got no answer, so it may have gone through. Check with ${open.carrier} whether a shipment exists for this order, then release the attempt on the order page before booking again.`);
    if (open) throw new AppError("BAD_INPUT", "A label is already being booked for these items. Wait a moment and reload the order.");
    return tx.shipmentAttempt.create({ data: { orderId, fingerprint, carrier: carrier.name, service: input.service, adminUserId: admin.id } });
  });

  let booked;
  try {
    booked = await carrier.book(request, input.service);
  } catch (error) {
    if (!(error instanceof CarrierError)) {
      await ctx.db.shipmentAttempt.update({ where: { id: attempt.id }, data: { status: "UNKNOWN", error: "Unexpected error while booking." } });
      throw error;
    }
    const answered = error.status !== undefined;
    await ctx.db.shipmentAttempt.update({ where: { id: attempt.id }, data: { status: answered ? "FAILED" : "UNKNOWN", error: error.message.slice(0, 500) } });
    await audit(ctx, answered ? "shipment.book_failed" : "shipment.book_unknown", "Order", orderId, { carrier: carrier.key, service: input.service, message: error.message.slice(0, 500) });
    await ctx.db.outboxJob.createMany({ data: [{ kind: "notify.owner.label_failed", dedupeKey: `notify.owner.label_failed:${attempt.id}`, payload: { orderId, carrier: carrier.name, message: error.message.slice(0, 300), unknown: !answered } }], skipDuplicates: true });
    throw new AppError("BAD_INPUT", answered ? `${error.message} Nothing was booked.` : `${error.message} It is not known whether ${carrier.name} booked the shipment. Check with ${carrier.name} before trying again.`);
  }

  try {
    const serviceName = carrier.services.find((service) => service.code === input.service)?.name ?? input.service;
    const shipmentId = await createShipment(ctx, orderId, { carrier: carrier.name, service: serviceName, trackingNumber: booked.trackingNumber, trackingUrl: booked.trackingUrl, items: input.items ?? null, parcels: input.boxes }, booked);
    await ctx.db.shipmentAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCEEDED", shipmentId } });
    await audit(ctx, "shipment.booked", "Order", orderId, { shipmentId, carrier: carrier.key, service: input.service, trackingNumber: booked.trackingNumber, environment: carrier.environment });
    return shipmentId;
  } catch (cause) {
    console.error("[fulfilment] carrier booked a shipment that could not be recorded", cause);
    await ctx.db.shipmentAttempt.update({ where: { id: attempt.id }, data: { status: "UNKNOWN", error: `Booked with ${carrier.name} (tracking ${booked.trackingNumber}) but not recorded here.` } });
    await audit(ctx, "shipment.orphaned", "Order", orderId, { carrier: carrier.key, carrierRef: booked.carrierRef, trackingNumber: booked.trackingNumber, note: "The carrier booked this shipment but it could not be recorded. Cancel it with the carrier." });
    throw new AppError("BAD_INPUT", `${carrier.name} booked the shipment (tracking ${booked.trackingNumber}) but it could not be saved here. Cancel it with ${carrier.name}, then release the attempt on the order page.`);
  }
}

/** After checking with the carrier that nothing was booked, lets the order be booked again. */
export async function releaseAttempt(ctx: Ctx, attemptId: string) {
  requireAdmin(ctx, "MANAGER", "shipping");
  const attempt = await ctx.db.shipmentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.status !== "UNKNOWN") throw new AppError("BAD_INPUT", "This attempt is not waiting to be checked.");
  await ctx.db.shipmentAttempt.update({ where: { id: attemptId }, data: { status: "FAILED", error: `${attempt.error ?? ""} Released by staff after checking with the carrier.`.trim() } });
  await audit(ctx, "shipment.attempt_released", "Order", attempt.orderId, { attemptId, carrier: attempt.carrier });
}

export function openAttempts(ctx: Ctx, orderId: string) {
  requireAdmin(ctx, "VIEW", "shipping");
  return ctx.db.shipmentAttempt.findMany({ where: { orderId, status: "UNKNOWN" }, orderBy: { createdAt: "desc" } });
}

/**
 * Books labels for many orders in one go, each as one box holding everything
 * not yet shipped (goods weight plus the packaging weight from Settings).
 * Orders are booked one after another; one that fails is reported and never
 * stops the rest.
 */
export async function bulkBookLabels(ctx: Ctx, orderIds: string[], input: { carrier: string; service: string }) {
  requireAdmin(ctx, "STAFF", "shipping");
  const ids = [...new Set(orderIds)].slice(0, 50);
  if (ids.length === 0) throw new AppError("BAD_INPUT", "Select at least one order.");
  if (!input.carrier || !input.service) throw new AppError("BAD_INPUT", "Choose a carrier and service.");
  const packaging = (await shippingSettings(ctx.db)).packagingGrams ?? 0;
  const orders = await ctx.db.order.findMany({ where: { id: { in: ids } }, include: { items: true } });
  const booked: { number: string; shipmentId: string }[] = [];
  const failed: { number: string; reason: string }[] = [];
  for (const order of orders) {
    const number = order.number ?? order.id;
    const goods = order.items.reduce((sum, item) => sum + item.weightGrams * Math.max(0, item.quantity - item.shippedQuantity), 0);
    try {
      if (goods <= 0) throw new AppError("BAD_INPUT", "The products on this order have no weight recorded, so the box cannot be weighed automatically.");
      booked.push({ number, shipmentId: await bookLabel(ctx, order.id, { carrier: input.carrier, service: input.service, boxes: [{ weightGrams: goods + packaging }] }) });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      failed.push({ number, reason: error.message });
    }
  }
  await audit(ctx, "shipment.bulk_book", "Order", null, { carrier: input.carrier, service: input.service, booked: booked.length, failed: failed.length });
  return { booked, failed };
}

/** Cancels a carrier booking and puts its units back to "not shipped". */
export async function cancelBooking(ctx: Ctx, shipmentId: string): Promise<{ cancelledWithCarrier: boolean }> {
  requireAdmin(ctx, "MANAGER", "shipping");
  const shipment = await ctx.db.shipment.findUnique({ where: { id: shipmentId }, include: { items: true, order: true } });
  if (!shipment || shipment.cancelledAt) throw new AppError("BAD_INPUT", "This shipment is not open.");
  if (shipment.status !== "LABEL_CREATED" && shipment.status !== "PENDING") throw new AppError("BAD_INPUT", "The carrier already has this parcel, so it can no longer be cancelled here.");

  let cancelledWithCarrier = false;
  if (shipment.source === "carrier") {
    const carrier = connectedCarriers().find((candidate) => candidate.name === shipment.carrier);
    if (carrier?.cancel && shipment.carrierRef && shipment.trackingNumber) {
      try {
        await carrier.cancel({ carrierRef: shipment.carrierRef, trackingNumber: shipment.trackingNumber, recipientCountryCode: shipment.order.shipCountryCode });
        cancelledWithCarrier = true;
      } catch (error) {
        if (!(error instanceof CarrierError)) throw error;
        throw new AppError("BAD_INPUT", `${error.message} The shipment was not cancelled.`);
      }
    }
  }

  await ctx.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${shipment.orderId} FOR UPDATE`;
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    for (const line of shipment.items) await tx.$executeRaw`UPDATE "OrderItem" SET "shippedQuantity" = GREATEST("shippedQuantity" - ${line.quantity}, 0) WHERE "id" = ${line.orderItemId}`;
    const items = await tx.orderItem.findMany({ where: { orderId: shipment.orderId } });
    await tx.order.update({ where: { id: shipment.orderId }, data: { fulfilmentStatus: fulfilmentFromQuantities(items, shipment.order.fulfilmentStatus) } });
    await syncOrderStatus(tx, shipment.orderId);
    await timeline(tx, ctx, shipment.orderId, "shipment_cancelled", `Shipment with ${shipment.carrier} cancelled${cancelledWithCarrier ? "" : " here only"}.`, true);
  });
  await audit(ctx, "shipment.cancelled", "Order", shipment.orderId, { shipmentId, cancelledWithCarrier });
  return { cancelledWithCarrier };
}

export async function getLabel(ctx: Ctx, shipmentId: string, position: number) {
  requireAdmin(ctx, "STAFF", "shipping");
  const label = await ctx.db.shipmentLabel.findFirst({ where: { shipmentId, position }, include: { shipment: { select: { orderId: true, trackingNumber: true } } } });
  if (!label) throw new AppError("NOT_FOUND", "Label not found.");
  await audit(ctx, "shipment.label_printed", "Order", label.shipment.orderId, { shipmentId, position });
  return label;
}

/**
 * Reads tracking for booked parcels that are still on their way, a few at a
 * time, and moves them on. Run by the scheduler. A carrier that cannot be
 * reached is simply tried again next time.
 */
export async function refreshTracking(db: Db, now = new Date(), limit = 20): Promise<{ checked: number; delivered: number }> {
  const carriers = connectedCarriers();
  if (carriers.length === 0) return { checked: 0, delivered: 0 };
  const due = await db.shipment.findMany({
    where: { source: "carrier", cancelledAt: null, status: { in: ["LABEL_CREATED", "IN_TRANSIT"] }, trackingNumber: { not: null }, OR: [{ trackingCheckedAt: null }, { trackingCheckedAt: { lt: new Date(now.getTime() - 2 * 3600_000) } }] },
    orderBy: { trackingCheckedAt: { sort: "asc", nulls: "first" } },
    take: limit,
  });
  let checked = 0;
  let delivered = 0;
  for (const shipment of due) {
    const carrier = carriers.find((candidate) => candidate.name === shipment.carrier);
    if (!carrier) continue;
    try {
      const tracking = await carrier.track(shipment.trackingNumber!);
      checked += 1;
      const events = tracking.events.map((event) => ({ at: event.at.toISOString(), description: event.description, location: event.location ?? null })) as Prisma.InputJsonValue;
      await db.$transaction(async (tx) => {
        const status = tracking.status ?? shipment.status;
        await tx.shipment.update({ where: { id: shipment.id }, data: { trackingEvents: events, trackingCheckedAt: now, status, deliveredAt: status === "DELIVERED" ? (tracking.deliveredAt ?? now) : null } });
        if (status !== "DELIVERED" || shipment.status === "DELIVERED") return;
        delivered += 1;
        // The order is delivered once every unit has left and none of its parcels is still travelling.
        const open = await tx.shipment.count({ where: { orderId: shipment.orderId, cancelledAt: null, status: { notIn: ["DELIVERED", "CANCELLED"] } } });
        const moved = open === 0 ? await tx.order.updateMany({ where: { id: shipment.orderId, fulfilmentStatus: "SHIPPED", cancelledAt: null }, data: { fulfilmentStatus: "DELIVERED" } }) : { count: 0 };
        if (moved.count === 1) {
          await syncOrderStatus(tx, shipment.orderId);
          await tx.orderEvent.create({ data: { orderId: shipment.orderId, kind: "delivered", message: `Delivered, according to ${shipment.carrier}.` } });
        }
      });
    } catch (error) {
      if (!(error instanceof CarrierError)) throw error;
      await db.shipment.update({ where: { id: shipment.id }, data: { trackingCheckedAt: now } });
    }
  }
  return { checked, delivered };
}

/** The shipping dashboard: what is waiting to leave, and what left recently. */
export async function fulfilmentBoard(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "shipping");
  const [waiting, shipments, settings] = await Promise.all([
    ctx.db.order.findMany({ where: { cancelledAt: null, paymentStatus: { in: PAYMENT_ALLOWS_FULFILMENT }, fulfilmentStatus: { in: ["UNFULFILLED", "PROCESSING", "READY", "PARTIALLY_SHIPPED"] } }, orderBy: { paidAt: "asc" }, take: 100, include: { items: true } }),
    ctx.db.shipment.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { order: { select: { id: true, number: true, shipCountryCode: true, shipFirstName: true, shipLastName: true } }, parcels: true, _count: { select: { labels: true } } } }),
    shippingSettings(ctx.db),
  ]);
  let senderComplete = true;
  try {
    senderFrom(settings);
  } catch {
    senderComplete = false;
  }
  return {
    carriers: carrierStates(),
    senderComplete,
    waiting: waiting.map((order) => {
      const left = order.items.map((item) => ({ item, quantity: item.quantity - item.shippedQuantity })).filter((line) => line.quantity > 0);
      return { order, units: left.reduce((sum, line) => sum + line.quantity, 0), weightGrams: left.reduce((sum, line) => sum + line.item.weightGrams * line.quantity, 0), needsCustoms: !EU.has(order.shipCountryCode) };
    }),
    shipments,
  };
}
