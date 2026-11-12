import type { FulfilmentStatus, OrderStatus, PaymentStatus } from "@/generated/prisma/client";
import type { Tx } from "./db";

/**
 * Order lifecycle.
 *
 * An order has two independent facts: where the money is (paymentStatus) and
 * where the goods are (fulfilmentStatus). The headline `status` shown in lists
 * and to the customer is derived from those two here, in one place, so it can
 * never disagree with them.
 */

export const ORDER_STATUSES = ["PENDING_PAYMENT", "PAYMENT_PROCESSING", "PAID", "PROCESSING", "READY_FOR_FULFILMENT", "PARTIALLY_SHIPPED", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"] as const satisfies readonly OrderStatus[];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Pending payment",
  PAYMENT_PROCESSING: "Payment processing",
  PAID: "Paid",
  PROCESSING: "Processing",
  READY_FOR_FULFILMENT: "Ready for fulfilment",
  PARTIALLY_SHIPPED: "Partially shipped",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
};

export const FULFILMENT_LABEL: Record<FulfilmentStatus, string> = {
  UNFULFILLED: "Unfulfilled",
  PROCESSING: "Processing",
  READY: "Ready to ship",
  PARTIALLY_SHIPPED: "Partially shipped",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
};

const BY_FULFILMENT: Record<FulfilmentStatus, OrderStatus> = {
  UNFULFILLED: "PAID",
  PROCESSING: "PROCESSING",
  READY: "READY_FOR_FULFILMENT",
  PARTIALLY_SHIPPED: "PARTIALLY_SHIPPED",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
};

export function deriveOrderStatus(order: { paymentStatus: PaymentStatus; fulfilmentStatus: FulfilmentStatus; cancelledAt: Date | null }): OrderStatus {
  if (order.cancelledAt) return "CANCELLED";
  switch (order.paymentStatus) {
    case "UNPAID":
    case "FAILED":
      return "PENDING_PAYMENT";
    case "PROCESSING":
      return "PAYMENT_PROCESSING";
    case "REFUNDED":
      return "REFUNDED";
    case "PARTIALLY_REFUNDED":
      return "PARTIALLY_REFUNDED";
    case "PAID":
      return BY_FULFILMENT[order.fulfilmentStatus];
  }
}

/** Goods may move only while we hold the customer's money. */
export const PAYMENT_ALLOWS_FULFILMENT: PaymentStatus[] = ["PAID", "PARTIALLY_REFUNDED"];

/** Fulfilment state implied by how many units of each line have been sent. */
export function fulfilmentFromQuantities(items: { quantity: number; shippedQuantity: number }[], current: FulfilmentStatus): FulfilmentStatus {
  const ordered = items.reduce((sum, item) => sum + item.quantity, 0);
  const shipped = items.reduce((sum, item) => sum + Math.min(item.shippedQuantity, item.quantity), 0);
  if (shipped === 0) return current === "PARTIALLY_SHIPPED" || current === "SHIPPED" ? "READY" : current;
  if (shipped < ordered) return "PARTIALLY_SHIPPED";
  return current === "DELIVERED" ? "DELIVERED" : "SHIPPED";
}

/** Recomputes and stores the headline status. Call inside the transaction that changed payment or fulfilment. */
export async function syncOrderStatus(tx: Tx, orderId: string): Promise<OrderStatus> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true, fulfilmentStatus: true, cancelledAt: true, status: true } });
  const status = deriveOrderStatus(order);
  if (status !== order.status) await tx.order.update({ where: { id: orderId }, data: { status } });
  return status;
}
