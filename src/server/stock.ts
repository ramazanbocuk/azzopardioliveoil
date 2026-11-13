import { requireAdmin } from "./auth";
import type { Ctx } from "./context";
import type { Tx } from "./db";
import { AppError } from "./errors";
import { fulfilmentFromQuantities, syncOrderStatus } from "./orderStatus";

/**
 * Stock held, stock owed, and what may leave the building.
 *
 * Three numbers describe every order line after payment:
 *   quantity            what the customer bought
 *   shippedQuantity     what has left in a shipment
 *   cancelledQuantity   what was taken off the order because it will not be supplied
 * and one row describes what is still owed from stock that had not arrived:
 *   Backorder           quantity - filledQuantity - cancelledQuantity = still waiting
 *
 * A unit can be dispatched only when it has been taken out of stock for this
 * order. Units on an open backorder have not, so they cannot be shipped until
 * arriving stock fills the backorder. That is what stops a parcel being
 * recorded for bottles that are not on the shelf.
 *
 * `Variant.stock` counts units still for sale or held for unpaid orders; a
 * paid unit leaves it at payment. `Variant.reserved` is the part held for
 * unpaid orders, and every hold has a StockReservation row saying whose it is.
 */

export type LineQuantities = { quantity: number; shippedQuantity: number; cancelledQuantity: number; backorder?: { quantity: number; filledQuantity: number; cancelledQuantity: number } | null };

/** Units of a backorder still waiting for stock. */
export const openBackorder = (backorder: LineQuantities["backorder"]) => (backorder ? Math.max(0, backorder.quantity - backorder.filledQuantity - backorder.cancelledQuantity) : 0);

/** Units of a line that are still to be sent, whether or not they are in stock yet. */
export const outstanding = (line: LineQuantities) => Math.max(0, line.quantity - line.cancelledQuantity - line.shippedQuantity);

/** Units of a line that are out of stock for this order and can be dispatched now. */
export const readyToShip = (line: LineQuantities) => Math.max(0, outstanding(line) - openBackorder(line.backorder));

/**
 * How an ordered quantity divides between what is on the shelf and what must
 * wait. Without the product's backorder switch, anything beyond the shelf is
 * refused, exactly as before.
 */
export function splitQuantity(available: number, wanted: number, allowBackorder: boolean): { fromStock: number; backorder: number } | null {
  const onShelf = Math.max(0, available);
  if (wanted <= onShelf) return { fromStock: wanted, backorder: 0 };
  return allowBackorder ? { fromStock: onShelf, backorder: wanted - onShelf } : null;
}

/**
 * What an order still owed once a given shipment had left: everything not
 * yet sent today, plus whatever went in later shipments. This is what that
 * shipment's packing slip and email call "still to follow", and it stays
 * true however long after the event it is printed or sent.
 */
export function afterShipment(
  items: (LineQuantities & { id: string; productName: string; variantLabel: string })[],
  shipments: { id: string; items: { orderItemId: string; quantity: number }[] }[],
  shipmentId: string,
): { index: number; total: number; first: boolean; toFollow: { name: string; quantity: number }[] } {
  const position = shipments.findIndex((shipment) => shipment.id === shipmentId);
  const later = position < 0 ? [] : shipments.slice(position + 1).flatMap((shipment) => shipment.items);
  const toFollow = items
    .map((item) => ({ name: `${item.productName} ${item.variantLabel}`, quantity: outstanding(item) + later.filter((line) => line.orderItemId === item.id).reduce((sum, line) => sum + line.quantity, 0) }))
    .filter((line) => line.quantity > 0);
  const owing = items.some((item) => outstanding(item) > 0);
  return { index: position + 1, total: shipments.length + (owing ? 1 : 0), first: position <= 0, toFollow };
}

// ───────────────────────────── Holds ─────────────────────────────

/**
 * Holds stock for one line of a new order and reports how much could not be
 * held. The variant row is locked first, so two checkouts cannot both take
 * the last bottle: the second one sees what the first one left.
 */
export async function holdStock(tx: Tx, variant: { id: string; allowBackorder: boolean }, wanted: number): Promise<{ held: number; backorder: number } | null> {
  const [row] = await tx.$queryRaw<{ stock: number; reserved: number; isActive: boolean }[]>`SELECT "stock", "reserved", "isActive" FROM "Variant" WHERE "id" = ${variant.id} FOR UPDATE`;
  if (!row?.isActive) return null;
  const split = splitQuantity(row.stock - row.reserved, wanted, variant.allowBackorder);
  if (!split) return null;
  if (split.fromStock > 0) await tx.variant.update({ where: { id: variant.id }, data: { reserved: { increment: split.fromStock } } });
  return { held: split.fromStock, backorder: split.backorder };
}

/** Gives back every hold an unpaid order still has, and lets waiting backorders take what was freed. */
export async function releaseHolds(tx: Tx, orderId: string): Promise<void> {
  const holds = await tx.stockReservation.findMany({ where: { orderId, status: "HELD" } });
  for (const hold of holds) {
    await tx.$executeRaw`UPDATE "Variant" SET "reserved" = GREATEST("reserved" - ${hold.quantity}, 0) WHERE "id" = ${hold.variantId}`;
  }
  await tx.stockReservation.updateMany({ where: { orderId, status: "HELD" }, data: { status: "RELEASED", closedAt: new Date() } });
  for (const variantId of new Set(holds.map((hold) => hold.variantId))) await allocateBackorders(tx, variantId);
}

// ───────────────────────────── Backorders ─────────────────────────────

/**
 * Gives newly available stock to the customers who have waited longest.
 * Call it, inside the same transaction, whenever stock for a variant goes up
 * or a hold on it is released. Each filled unit leaves stock with a ledger
 * entry naming the order, and the order's staff timeline says it can now ship.
 */
export async function allocateBackorders(tx: Tx, variantId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ stock: number; reserved: number }[]>`SELECT "stock", "reserved" FROM "Variant" WHERE "id" = ${variantId} FOR UPDATE`;
  if (!row) return 0;
  let available = row.stock - row.reserved;
  if (available <= 0) return 0;

  const waiting = await tx.backorder.findMany({ where: { variantId, closedAt: null }, orderBy: { createdAt: "asc" }, include: { orderItem: { select: { productName: true, variantLabel: true } } } });
  let filled = 0;
  for (const backorder of waiting) {
    if (available <= 0) break;
    const open = openBackorder(backorder);
    const give = Math.min(open, available);
    if (give <= 0) continue;
    await tx.variant.update({ where: { id: variantId }, data: { stock: { decrement: give } } });
    await tx.backorder.update({ where: { id: backorder.id }, data: { filledQuantity: { increment: give }, closedAt: give === open ? new Date() : null } });
    await tx.inventoryMovement.create({ data: { variantId, delta: -give, reason: "SALE", orderId: backorder.orderId, note: "Backorder filled from arriving stock" } });
    await tx.orderEvent.create({ data: { orderId: backorder.orderId, kind: "backorder_filled", isInternal: true, message: `${give} × ${backorder.orderItem.productName} ${backorder.orderItem.variantLabel} came into stock for this order and can now be shipped.` } });
    available -= give;
    filled += give;
  }
  return filled;
}

/** Every line still waiting for stock, oldest first: the list the warehouse works from when a delivery arrives. */
export async function listBackorders(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "orders");
  const rows = await ctx.db.backorder.findMany({
    where: { closedAt: null },
    orderBy: { createdAt: "asc" },
    include: { orderItem: { select: { sku: true, productName: true, variantLabel: true, order: { select: { id: true, number: true, email: true, shipFirstName: true, shipLastName: true, shipCountryCode: true, paidAt: true } } } } },
  });
  const stock = new Map((await ctx.db.variant.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.variantId))] } }, select: { id: true, stock: true, reserved: true } })).map((variant) => [variant.id, variant.stock - variant.reserved]));
  const lines = rows.map((row) => ({ id: row.id, orderId: row.orderItem.order.id, number: row.orderItem.order.number, customer: `${row.orderItem.order.shipFirstName} ${row.orderItem.order.shipLastName}`, country: row.orderItem.order.shipCountryCode, paidAt: row.orderItem.order.paidAt, sku: row.orderItem.sku, name: `${row.orderItem.productName} ${row.orderItem.variantLabel}`, open: openBackorder(row), since: row.createdAt, available: stock.get(row.variantId) ?? 0 }));
  const bySku = new Map<string, { sku: string; name: string; open: number; orders: number }>();
  for (const line of lines) {
    const entry = bySku.get(line.sku) ?? { sku: line.sku, name: line.name, open: 0, orders: 0 };
    bySku.set(line.sku, { ...entry, open: entry.open + line.open, orders: entry.orders + 1 });
  }
  return { lines, replenish: [...bySku.values()].sort((a, b) => b.open - a.open), units: lines.reduce((sum, line) => sum + line.open, 0) };
}

/**
 * Takes units off a paid order because they will not be supplied. Units still
 * waiting for stock are cancelled first; any others go back on sale. Money is
 * not moved here: the refund is a separate, deliberate step, and the order's
 * timeline states the amount those units cost so it is not forgotten.
 */
export async function cancelOutstanding(ctx: Ctx, orderItemId: string, quantity: number): Promise<{ orderId: string; valueCents: number }> {
  const admin = requireAdmin(ctx, "MANAGER", "orders");
  if (!Number.isInteger(quantity) || quantity < 1) throw new AppError("BAD_INPUT", "Enter how many units to take off the order.");
  const result = await ctx.db.$transaction(async (tx) => {
    const found = await tx.orderItem.findUnique({ where: { id: orderItemId }, select: { orderId: true } });
    if (!found) throw new AppError("NOT_FOUND", "That line is not part of an order.");
    await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${found.orderId} FOR UPDATE`;
    const item = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, include: { backorder: true, order: { select: { paymentStatus: true, cancelledAt: true, fulfilmentStatus: true } } } });
    if (item.order.cancelledAt || !["PAID", "PARTIALLY_REFUNDED"].includes(item.order.paymentStatus)) throw new AppError("BAD_INPUT", "Units can be taken off a paid order only. Cancel an unpaid order as a whole.");
    if (quantity > outstanding(item)) throw new AppError("BAD_INPUT", `${item.productName} ${item.variantLabel}: only ${outstanding(item)} not yet shipped.`);

    // Cancel what is still waiting for stock first; what remains was already taken from stock and goes back on sale.
    const fromBackorder = Math.min(quantity, openBackorder(item.backorder));
    const fromStock = quantity - fromBackorder;
    if (item.backorder && fromBackorder > 0) {
      const closes = openBackorder(item.backorder) === fromBackorder;
      await tx.backorder.update({ where: { id: item.backorder.id }, data: { cancelledQuantity: { increment: fromBackorder }, closedAt: closes ? new Date() : null } });
    }
    await tx.orderItem.update({ where: { id: orderItemId }, data: { cancelledQuantity: { increment: quantity } } });
    if (fromStock > 0 && item.variantId) {
      await tx.variant.update({ where: { id: item.variantId }, data: { stock: { increment: fromStock } } });
      await tx.inventoryMovement.create({ data: { variantId: item.variantId, delta: fromStock, reason: "RETURN", orderId: item.orderId, adminUserId: admin.id, note: "Taken off the order before shipping" } });
      await allocateBackorders(tx, item.variantId);
    }

    const items = await tx.orderItem.findMany({ where: { orderId: item.orderId } });
    await tx.order.update({ where: { id: item.orderId }, data: { fulfilmentStatus: fulfilmentFromQuantities(items, item.order.fulfilmentStatus) } });
    await syncOrderStatus(tx, item.orderId);
    const valueCents = item.unitPriceCents * quantity;
    await tx.orderEvent.create({ data: { orderId: item.orderId, kind: "line_cancelled", adminUserId: admin.id, message: `${quantity} × ${item.productName} ${item.variantLabel} removed from your order.` } });
    await tx.orderEvent.create({ data: { orderId: item.orderId, kind: "refund_due", isInternal: true, adminUserId: admin.id, message: `Units worth ${(valueCents / 100).toFixed(2)} at list price were taken off this order. No money has been returned: issue the refund below if the customer is owed one.` } });
    return { orderId: item.orderId, valueCents };
  });
  await ctx.db.auditLog.create({ data: { actorType: "admin", actorId: admin.id, action: "order.line.cancel", entity: "Order", entityId: result.orderId, data: { orderItemId, quantity, valueCents: result.valueCents }, ip: ctx.ip } });
  return result;
}
