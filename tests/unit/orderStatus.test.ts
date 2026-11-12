import { describe, expect, it } from "vitest";
import { deriveOrderStatus, fulfilmentFromQuantities } from "@/server/orderStatus";

const order = (paymentStatus: Parameters<typeof deriveOrderStatus>[0]["paymentStatus"], fulfilmentStatus: Parameters<typeof deriveOrderStatus>[0]["fulfilmentStatus"] = "UNFULFILLED", cancelled = false) => ({ paymentStatus, fulfilmentStatus, cancelledAt: cancelled ? new Date() : null });

describe("order status", () => {
  it("derives the headline status from payment and fulfilment", () => {
    expect(deriveOrderStatus(order("UNPAID"))).toBe("PENDING_PAYMENT");
    expect(deriveOrderStatus(order("FAILED"))).toBe("PENDING_PAYMENT");
    expect(deriveOrderStatus(order("PROCESSING"))).toBe("PAYMENT_PROCESSING");
    expect(deriveOrderStatus(order("PAID"))).toBe("PAID");
    expect(deriveOrderStatus(order("PAID", "PROCESSING"))).toBe("PROCESSING");
    expect(deriveOrderStatus(order("PAID", "READY"))).toBe("READY_FOR_FULFILMENT");
    expect(deriveOrderStatus(order("PAID", "PARTIALLY_SHIPPED"))).toBe("PARTIALLY_SHIPPED");
    expect(deriveOrderStatus(order("PAID", "SHIPPED"))).toBe("SHIPPED");
    expect(deriveOrderStatus(order("PAID", "DELIVERED"))).toBe("DELIVERED");
  });

  it("lets money and cancellation outrank fulfilment", () => {
    expect(deriveOrderStatus(order("PARTIALLY_REFUNDED", "SHIPPED"))).toBe("PARTIALLY_REFUNDED");
    expect(deriveOrderStatus(order("REFUNDED", "DELIVERED"))).toBe("REFUNDED");
    expect(deriveOrderStatus(order("UNPAID", "UNFULFILLED", true))).toBe("CANCELLED");
    expect(deriveOrderStatus(order("PAID", "SHIPPED", true))).toBe("CANCELLED");
  });

  it("reads fulfilment from the units that have left", () => {
    const items = (shipped: number[]) => [2, 1].map((quantity, index) => ({ quantity, shippedQuantity: shipped[index] }));
    expect(fulfilmentFromQuantities(items([0, 0]), "PROCESSING")).toBe("PROCESSING");
    expect(fulfilmentFromQuantities(items([1, 0]), "READY")).toBe("PARTIALLY_SHIPPED");
    expect(fulfilmentFromQuantities(items([2, 0]), "READY")).toBe("PARTIALLY_SHIPPED");
    expect(fulfilmentFromQuantities(items([2, 1]), "PARTIALLY_SHIPPED")).toBe("SHIPPED");
    expect(fulfilmentFromQuantities(items([2, 1]), "DELIVERED")).toBe("DELIVERED");
    expect(fulfilmentFromQuantities(items([9, 9]), "READY")).toBe("SHIPPED"); // over-counting can never exceed "shipped"
  });
});
