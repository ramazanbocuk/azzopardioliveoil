import { holdStock, releaseHolds } from "./stock";
import { toLocale } from "@/i18n/config";
import { z } from "zod";
import { WHOLESALE_CODE, activeDiscount, findCart, summarise, toLines } from "./cart";
import type { Ctx } from "./context";
import { hashToken, newToken } from "./crypto";
import type { Db } from "./db";
import { AppError, parse } from "./errors";
import { applicableRates, computeTotals, orderNumber, taxBreakdown } from "./pricing";
import { enforce } from "./rateLimit";

/** How long stock stays held for an order that has not been paid yet. */
export const RESERVATION_MINUTES = 40;

const text = (max: number) => z.string().trim().min(1, "This field is required.").max(max);

const checkoutInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  shippingRateId: z.string().min(1).max(60),
  address: z.object({
    firstName: text(80),
    lastName: text(80),
    line1: text(160),
    line2: z.string().trim().max(160).nullish(),
    postalCode: text(20),
    city: text(120),
    region: z.string().trim().max(120).nullish(),
    countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a country."),
    phone: z.string().trim().max(40).nullish(),
  }),
  /** Omitted = bill to the delivery address. */
  billing: z
    .object({
      firstName: text(80),
      lastName: text(80),
      company: z.string().trim().max(160).nullish(),
      vatNumber: z.string().trim().max(40).nullish(),
      line1: text(160),
      line2: z.string().trim().max(160).nullish(),
      postalCode: text(20),
      city: text(120),
      region: z.string().trim().max(120).nullish(),
      countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a country."),
    })
    .nullish(),
  customerNote: z.string().trim().max(500).nullish(),
  // GraphQL sends null for omitted optional inputs, so every optional field accepts it.
  locale: z.string().max(10).nullish(),
});

async function zoneRates(db: Db, countryCode: string) {
  const zone = await db.shippingZone.findFirst({
    where: { isActive: true, countries: { has: countryCode } },
    include: { rates: { where: { isActive: true }, orderBy: { position: "asc" } } },
  });
  return zone?.rates ?? [];
}

/** Shipping choices for the visitor's cart and a destination. Empty = we do not deliver there. */
export async function shippingOptions(ctx: Ctx, rawCountry: string) {
  const countryCode = rawCountry.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new AppError("BAD_INPUT", "Choose a country.", "countryCode");
  const cart = await summarise(ctx.db, await findCart(ctx));
  return applicableRates(await zoneRates(ctx.db, countryCode), cart.weightGrams, cart.subtotalCents - cart.discountCents, cart.freeShippingDiscount);
}

/**
 * Turns the cart into an order awaiting payment.
 *
 * Everything that matters is decided here, on the server, inside one
 * transaction: prices are read from the database, the discount and shipping
 * rate are re-validated, and stock is reserved with a conditional update so
 * two customers cannot both buy the last bottle. The order is NOT paid — only
 * a verified payment webhook (Phase 5) may mark it so.
 */
export async function placeOrder(ctx: Ctx, input: unknown) {
  const data = parse(checkoutInput, input);
  await enforce(ctx.db, `checkout:ip:${ctx.ip}`, 20, 600);

  const cart = await findCart(ctx);
  if (!cart || cart.items.length === 0) throw new AppError("CART_EMPTY", "Your cart is empty.");

  for (const item of cart.items) {
    if (!item.variant.isActive || !item.variant.product.isVisible || item.variant.product.deletedAt) {
      throw new AppError("OUT_OF_STOCK", `${item.variant.product.name} ${item.variant.label} is no longer available.`);
    }
  }

  const lines = toLines(cart);
  const discount = await activeDiscount(ctx.db, cart);
  // A code on the cart must still be usable, unless the customer's trade terms beat it anyway.
  if (cart.discountCode && !discount) throw new AppError("DISCOUNT_INVALID", "The discount code on your cart can no longer be used.", "code");

  const summary = await summarise(ctx.db, cart);
  const options = applicableRates(await zoneRates(ctx.db, data.address.countryCode), summary.weightGrams, summary.subtotalCents - summary.discountCents, summary.freeShippingDiscount);
  const rate = options.find((option) => option.id === data.shippingRateId);
  if (!rate) throw new AppError("SHIPPING_UNAVAILABLE", "That shipping method is not available for this address.", "shippingRateId");

  const tax = await ctx.db.taxRate.findFirst({ where: { countryCode: data.address.countryCode, isActive: true } });
  const totals = computeTotals({ lines, discount, shippingCents: rate.priceCents, taxRateBps: tax?.rateBps ?? null });

  const breakdown = taxBreakdown({ lines, discountCents: totals.discountCents, shippingCents: totals.shippingCents, taxRateBps: tax?.rateBps ?? null });
  const billing = data.billing ?? { ...data.address, company: null, vatNumber: null };

  const accessToken = newToken();

  const order = await ctx.db.$transaction(async (tx) => {
    // Hold what is on the shelf. Where the owner allows it, the rest of a line becomes a backorder; otherwise the order is refused.
    const holds = new Map<string, { held: number; backorder: number }>();
    for (const item of cart.items) {
      const hold = await holdStock(tx, { id: item.variantId, allowBackorder: item.variant.product.allowBackorder }, item.quantity);
      if (!hold) throw new AppError("OUT_OF_STOCK", `${item.variant.product.name} ${item.variant.label} does not have enough stock.`);
      holds.set(item.variantId, hold);
    }

    // Trade terms are not a counted code: there is no usage limit to consume.
    if (discount && discount.code !== WHOLESALE_CODE) {
      const used = await tx.$executeRaw`
        UPDATE "Discount" SET "usedCount" = "usedCount" + 1
        WHERE "code" = ${discount.code} AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
      if (used !== 1) throw new AppError("DISCOUNT_INVALID", "This code has been fully used.", "code");
    }

    const created = await tx.order.create({
      data: {
        customerId: ctx.customer?.id ?? null,
        email: data.email,
        // The language the customer shopped in; their emails follow it.
        locale: toLocale(data.locale ?? ctx.locale),
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        shippingCents: totals.shippingCents,
        taxCents: totals.taxCents,
        taxRateBps: tax?.rateBps ?? null,
        shippingTaxCents: breakdown.shippingTaxCents,
        totalCents: totals.totalCents,
        discountCode: discount?.code ?? null,
        shippingRateName: rate.name,
        shippingCarrier: rate.carrier,
        weightGrams: summary.weightGrams,
        shipFirstName: data.address.firstName,
        shipLastName: data.address.lastName,
        shipLine1: data.address.line1,
        shipLine2: data.address.line2 || null,
        shipPostalCode: data.address.postalCode,
        shipCity: data.address.city,
        shipRegion: data.address.region || null,
        shipCountryCode: data.address.countryCode,
        shipPhone: data.address.phone || null,
        billFirstName: billing.firstName,
        billLastName: billing.lastName,
        billCompany: billing.company || null,
        billVatNumber: billing.vatNumber || null,
        billLine1: billing.line1,
        billLine2: billing.line2 || null,
        billPostalCode: billing.postalCode,
        billCity: billing.city,
        billRegion: billing.region || null,
        billCountryCode: billing.countryCode,
        customerNote: data.customerNote || null,
        reservedUntil: new Date(Date.now() + RESERVATION_MINUTES * 60_000),
        accessTokenHash: hashToken(accessToken),
        items: {
          create: cart.items.map((item, index) => ({
            variantId: item.variantId,
            sku: item.variant.sku,
            productName: item.variant.product.name,
            variantLabel: item.variant.label,
            unitPriceCents: item.variant.priceCents,
            quantity: item.quantity,
            backorderQuantity: holds.get(item.variantId)?.backorder ?? 0,
            lineTotalCents: item.variant.priceCents * item.quantity,
            taxRateBps: tax?.rateBps ?? null,
            taxCents: breakdown.lineTaxCents[index],
            weightGrams: item.variant.weightGrams,
            hsCode: item.variant.product.hsCode,
            originCountry: item.variant.product.originCountry,
          })),
        },
        events: { create: { kind: "placed", message: "Order placed, awaiting payment." } },
      },
    });

    // A record of each hold, so staff can see which order is holding which bottles and until when.
    const placed = await tx.orderItem.findMany({ where: { orderId: created.id }, select: { id: true, variantId: true } });
    const expiresAt = created.reservedUntil ?? new Date();
    await tx.stockReservation.createMany({
      data: placed.flatMap((line) => {
        const held = line.variantId ? (holds.get(line.variantId)?.held ?? 0) : 0;
        return line.variantId && held > 0 ? [{ orderId: created.id, orderItemId: line.id, variantId: line.variantId, quantity: held, expiresAt }] : [];
      }),
    });

    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await tx.cart.update({ where: { id: cart.id }, data: { discountCode: null } });

    return tx.order.update({ where: { id: created.id }, data: { number: orderNumber(created.sequence) }, include: { items: true, events: true } });
  });

  // The token is returned once, to the browser that placed the order, and never stored in clear.
  return { ...order, accessToken };
}

/**
 * Cancels unpaid orders whose reservation has lapsed and returns their stock
 * to sale. Safe to run repeatedly; called by a scheduled job.
 */
export async function releaseExpiredReservations(db: Db, now = new Date()): Promise<number> {
  // An order whose payment is still being processed by the bank keeps its stock until the provider answers.
  const expired = await db.order.findMany({ where: { paymentStatus: { in: ["UNPAID", "FAILED"] }, cancelledAt: null, reservedUntil: { lt: now } }, include: { items: true } });
  let released = 0;
  for (const order of expired) {
    await db.$transaction(async (tx) => {
      // Re-check inside the transaction: a webhook may have paid it meanwhile.
      const claimed = await tx.order.updateMany({ where: { id: order.id, paymentStatus: { in: ["UNPAID", "FAILED"] }, cancelledAt: null }, data: { status: "CANCELLED", cancelledAt: now, reservedUntil: null } });
      if (claimed.count !== 1) return;
      await releaseHolds(tx, order.id);
      if (order.discountCode) await tx.$executeRaw`UPDATE "Discount" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "code" = ${order.discountCode}`;
      await tx.orderEvent.create({ data: { orderId: order.id, kind: "cancelled", message: "Order cancelled: payment was not completed in time." } });
      released += 1;
    });
  }
  return released;
}

// Customers never see staff-only timeline entries.
/**
 * What a customer sees of their order: the lines with what is still owed,
 * the public timeline, and every parcel with its own contents and tracking.
 * A cancelled booking is not a parcel and is left out.
 */
const orderInclude = {
  items: { include: { backorder: true } },
  events: { where: { isInternal: false }, orderBy: { createdAt: "asc" } },
  shipments: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, include: { items: { include: { orderItem: { select: { sku: true, productName: true, variantLabel: true } } } }, events: { orderBy: { occurredAt: "desc" }, take: 8 } } },
} as const;

/** Guest lookup. Number and email must both match; the answer is the same for "wrong number" and "wrong email". */
export async function findOrderForGuest(ctx: Ctx, number: string, email: string) {
  await enforce(ctx.db, `order-lookup:ip:${ctx.ip}`, 15, 600);
  const order = await ctx.db.order.findUnique({ where: { number: number.trim().toUpperCase().replace(/^#/, "") }, include: orderInclude });
  return order && order.email === email.trim().toLowerCase() ? order : null;
}

/** Opens an order from the private link given to whoever placed it. */
export async function findOrderByToken(ctx: Ctx, number: string, token: string) {
  await enforce(ctx.db, `order-token:ip:${ctx.ip}`, 60, 600);
  const order = await ctx.db.order.findUnique({ where: { number: number.trim().toUpperCase() }, include: orderInclude });
  return order && order.accessTokenHash && order.accessTokenHash === hashToken(token) ? order : null;
}

export function listOrdersForCustomer(db: Db, customerId: string) {
  return db.order.findMany({ where: { customerId }, orderBy: { placedAt: "desc" }, include: orderInclude });
}
