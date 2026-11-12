import { COOKIE, TTL, setCookie, type Ctx } from "./context";
import { hashToken, newToken } from "./crypto";
import type { Db } from "./db";
import { AppError } from "./errors";
import { MAX_LINE_QUANTITY, discountAmount, discountProblem, subtotalCents, totalWeightGrams, type DiscountRule } from "./pricing";

const cartInclude = {
  items: { orderBy: { addedAt: "asc" }, include: { variant: { include: { product: true } } } },
} as const;

async function load(db: Db, id: string) {
  return db.cart.findUniqueOrThrow({ where: { id }, include: cartInclude });
}

export type LoadedCart = Awaited<ReturnType<typeof load>>;

/** The visitor's cart, if they have one. Never creates a row for a read. */
export async function findCart(ctx: Ctx): Promise<LoadedCart | null> {
  const token = ctx.cookies[COOKIE.cart];
  if (!token) return null;
  return ctx.db.cart.findUnique({ where: { tokenHash: hashToken(token) }, include: cartInclude });
}

async function getOrCreateCart(ctx: Ctx): Promise<LoadedCart> {
  const existing = await findCart(ctx);
  if (existing) return existing;
  const token = newToken();
  const created = await ctx.db.cart.create({ data: { tokenHash: hashToken(token), customerId: ctx.customer?.id ?? null }, include: cartInclude });
  setCookie(ctx, COOKIE.cart, token, TTL.cart);
  return created;
}

function checkQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
    throw new AppError("BAD_INPUT", `Quantity must be between 1 and ${MAX_LINE_QUANTITY}.`, "quantity");
  }
}

async function purchasableVariant(db: Db, sku: string) {
  const variant = await db.variant.findUnique({ where: { sku }, include: { product: true } });
  if (!variant || !variant.isActive || !variant.product.isVisible || variant.product.deletedAt) {
    throw new AppError("NOT_FOUND", "This product is not available.", "sku");
  }
  return variant;
}

function checkAvailable(variant: { stock: number; reserved: number }, wanted: number) {
  const available = variant.stock - variant.reserved;
  if (available < wanted) {
    throw new AppError("OUT_OF_STOCK", available > 0 ? `Only ${available} left in stock.` : "This size is sold out.", "quantity");
  }
}

export async function addItem(ctx: Ctx, sku: string, quantity: number): Promise<LoadedCart> {
  checkQuantity(quantity);
  const variant = await purchasableVariant(ctx.db, sku);
  const cart = await getOrCreateCart(ctx);
  const current = cart.items.find((item) => item.variantId === variant.id)?.quantity ?? 0;
  const next = Math.min(MAX_LINE_QUANTITY, current + quantity);
  checkAvailable(variant, next);
  await ctx.db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    create: { cartId: cart.id, variantId: variant.id, quantity: next },
    update: { quantity: next },
  });
  return load(ctx.db, cart.id);
}

export async function setQuantity(ctx: Ctx, sku: string, quantity: number): Promise<LoadedCart> {
  checkQuantity(quantity);
  const cart = await getOrCreateCart(ctx);
  const variant = await purchasableVariant(ctx.db, sku);
  checkAvailable(variant, quantity);
  await ctx.db.cartItem.updateMany({ where: { cartId: cart.id, variantId: variant.id }, data: { quantity } });
  return load(ctx.db, cart.id);
}

export async function removeItem(ctx: Ctx, sku: string): Promise<LoadedCart> {
  const cart = await getOrCreateCart(ctx);
  await ctx.db.cartItem.deleteMany({ where: { cartId: cart.id, variant: { sku } } });
  return load(ctx.db, cart.id);
}

export async function applyDiscount(ctx: Ctx, rawCode: string): Promise<LoadedCart> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw new AppError("DISCOUNT_INVALID", "This code is not valid.", "code");
  const cart = await getOrCreateCart(ctx);
  const discount = await ctx.db.discount.findUnique({ where: { code } });
  // One message for "unknown" and "not usable" would hide useful detail from
  // honest customers; unknown codes get a generic answer, real ones a reason.
  if (!discount) throw new AppError("DISCOUNT_INVALID", "This code is not valid.", "code");
  const problem = discountProblem(discount, subtotalCents(toLines(cart)), new Date());
  if (problem) throw new AppError("DISCOUNT_INVALID", problem, "code");
  await ctx.db.cart.update({ where: { id: cart.id }, data: { discountCode: code } });
  return load(ctx.db, cart.id);
}

export async function removeDiscount(ctx: Ctx): Promise<LoadedCart> {
  const cart = await getOrCreateCart(ctx);
  await ctx.db.cart.update({ where: { id: cart.id }, data: { discountCode: null } });
  return load(ctx.db, cart.id);
}

export function toLines(cart: LoadedCart) {
  return cart.items.map((item) => ({ unitPriceCents: item.variant.priceCents, quantity: item.quantity, weightGrams: item.variant.weightGrams }));
}

/** The discount on the cart, if it is still usable right now. */
export async function activeDiscount(db: Db, cart: LoadedCart): Promise<DiscountRule | null> {
  if (!cart.discountCode) return null;
  const discount = await db.discount.findUnique({ where: { code: cart.discountCode } });
  if (!discount || discountProblem(discount, subtotalCents(toLines(cart)), new Date())) return null;
  return discount;
}

/** What the storefront shows for a cart. Prices come from the database, never the client. */
export async function summarise(db: Db, cart: LoadedCart | null) {
  if (!cart) return { id: null, lines: [], itemCount: 0, subtotalCents: 0, discountCents: 0, discountCode: null, freeShippingDiscount: false, weightGrams: 0 };
  const lines = toLines(cart);
  const subtotal = subtotalCents(lines);
  const discount = await activeDiscount(db, cart);
  const { discountCents, freeShipping } = discountAmount(discount, subtotal);
  return {
    id: cart.id,
    lines: cart.items.map((item) => ({
      sku: item.variant.sku,
      quantity: item.quantity,
      unitPriceCents: item.variant.priceCents,
      lineTotalCents: item.variant.priceCents * item.quantity,
      available: item.variant.stock - item.variant.reserved,
      variant: item.variant,
      product: item.variant.product,
    })),
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalCents: subtotal,
    discountCents,
    discountCode: discount?.code ?? null,
    freeShippingDiscount: freeShipping,
    weightGrams: totalWeightGrams(lines),
  };
}

export type CartSummary = Awaited<ReturnType<typeof summarise>>;
