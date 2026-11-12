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

type ShippingSettings = Partial<Record<"senderName" | "senderCompany" | "senderLine1" | "senderLine2" | "senderPostalCode" | "senderCity" | "senderCountryCode" | "senderPhone" | "senderEmail", string | null>> & { carrierRule?: "manual" | "cheapest" | "fastest"; packagingGrams?: number };

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

export function buildShipmentRequest(order: FullOrder, sender: Party, boxes: Box[], wanted: Line[] | null | undefined, reference: string, shipDate = new Date()): ShipmentRequest {
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
  requireAdmin(ctx);
  const order = await shippableOrder(ctx, orderId);
  const settings = await shippingSettings(ctx.db);
  const request = buildShipmentRequest(order, senderFrom(settings), boxes, wanted, order.number ?? order.id);
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

/**
 * Books the shipment with the carrier, stores the label it returns, and
 * records the shipment. The carrier is called first: if it refuses, nothing
 * is recorded. If recording fails after the carrier accepted, the booking is
 * written to the audit log with its tracking number so it can be cancelled.
 */
export async function bookLabel(ctx: Ctx, orderId: string, input: { carrier: string; service: string; boxes: Box[]; items?: Line[] | null }): Promise<string> {
  requireAdmin(ctx);
  const order = await shippableOrder(ctx, orderId);
  let carrier;
  try {
    carrier = getCarrier(input.carrier);
  } catch (error) {
    throw error instanceof CarrierNotConnected ? new AppError("BAD_INPUT", error.message) : error;
  }
  if (!input.service) throw new AppError("BAD_INPUT", "Choose a service.");
  const previous = await ctx.db.shipment.count({ where: { orderId } });
  const request = buildShipmentRequest(order, senderFrom(await shippingSettings(ctx.db)), input.boxes, input.items, `${order.number ?? order.id}-${previous + 1}`);

  let booked;
  try {
    booked = await carrier.book(request, input.service);
  } catch (error) {
    if (!(error instanceof CarrierError)) throw error;
    await audit(ctx, "shipment.book_failed", "Order", orderId, { carrier: carrier.key, service: input.service, message: error.message.slice(0, 500) });
    throw new AppError("BAD_INPUT", `${error.message} Nothing was booked.`);
  }

  try {
    const serviceName = carrier.services.find((service) => service.code === input.service)?.name ?? input.service;
    const shipmentId = await createShipment(ctx, orderId, { carrier: carrier.name, service: serviceName, trackingNumber: booked.trackingNumber, trackingUrl: booked.trackingUrl, items: input.items ?? null, parcels: input.boxes }, booked);
    await audit(ctx, "shipment.booked", "Order", orderId, { shipmentId, carrier: carrier.key, service: input.service, trackingNumber: booked.trackingNumber, environment: carrier.environment });
    return shipmentId;
  } catch (cause) {
    console.error("[fulfilment] carrier booked a shipment that could not be recorded", cause);
    await audit(ctx, "shipment.orphaned", "Order", orderId, { carrier: carrier.key, carrierRef: booked.carrierRef, trackingNumber: booked.trackingNumber, note: "The carrier booked this shipment but it could not be recorded. Cancel it with the carrier." });
    throw new AppError("BAD_INPUT", `${carrier.name} booked the shipment (tracking ${booked.trackingNumber}) but it could not be saved here. Cancel it with ${carrier.name} and try again.`);
  }
}

/** Cancels a carrier booking and puts its units back to "not shipped". */
export async function cancelBooking(ctx: Ctx, shipmentId: string): Promise<{ cancelledWithCarrier: boolean }> {
  requireAdmin(ctx, "MANAGER");
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
  requireAdmin(ctx);
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
  requireAdmin(ctx);
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
