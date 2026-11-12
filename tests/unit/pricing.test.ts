import { describe, expect, it } from "vitest";
import { allocateCents, taxBreakdown, applicableRates, computeTotals, discountAmount, discountProblem, includedTaxCents, orderNumber, subtotalCents, totalWeightGrams, type DiscountRule, type RateRule } from "@/server/pricing";

const lines = [
  { unitPriceCents: 1800, quantity: 2, weightGrams: 950 },
  { unitPriceCents: 3200, quantity: 1, weightGrams: 1750 },
];

const discount = (over: Partial<DiscountRule> = {}): DiscountRule => ({ code: "X", kind: "PERCENT", value: 10, minSubtotalCents: 0, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, isActive: true, ...over });
const rate = (over: Partial<RateRule> = {}): RateRule => ({ id: "r", name: "Standard", carrier: null, priceCents: 695, minWeightGrams: 0, maxWeightGrams: null, freeAboveCents: null, estimate: null, ...over });

describe("pricing", () => {
  it("adds up subtotal and weight", () => {
    expect(subtotalCents(lines)).toBe(6800);
    expect(totalWeightGrams(lines)).toBe(3650);
  });

  it("applies percent, fixed and free-shipping discounts", () => {
    expect(discountAmount(discount(), 6800)).toEqual({ discountCents: 680, freeShipping: false });
    expect(discountAmount(discount({ kind: "FIXED", value: 500 }), 6800).discountCents).toBe(500);
    expect(discountAmount(discount({ kind: "FREE_SHIPPING" }), 6800)).toEqual({ discountCents: 0, freeShipping: true });
    expect(discountAmount(null, 6800).discountCents).toBe(0);
  });

  it("never discounts below zero or above 100%", () => {
    expect(discountAmount(discount({ kind: "FIXED", value: 99999 }), 6800).discountCents).toBe(6800);
    expect(discountAmount(discount({ value: 250 }), 6800).discountCents).toBe(6800);
    expect(discountAmount(discount({ value: -5 }), 6800).discountCents).toBe(0);
  });

  it("explains why a code cannot be used", () => {
    const now = new Date("2026-06-01T12:00:00Z");
    expect(discountProblem(discount(), 6800, now)).toBeNull();
    expect(discountProblem(discount({ isActive: false }), 6800, now)).toMatch(/not active/);
    expect(discountProblem(discount({ startsAt: new Date("2026-07-01") }), 6800, now)).toMatch(/not valid yet/);
    expect(discountProblem(discount({ endsAt: new Date("2026-05-01") }), 6800, now)).toMatch(/expired/);
    expect(discountProblem(discount({ usageLimit: 3, usedCount: 3 }), 6800, now)).toMatch(/fully used/);
    expect(discountProblem(discount({ minSubtotalCents: 10000 }), 6800, now)).toMatch(/minimum/);
  });

  it("picks shipping rates by weight band and free threshold", () => {
    const rates = [rate({ id: "light", maxWeightGrams: 2000 }), rate({ id: "heavy", minWeightGrams: 2001, priceCents: 995, freeAboveCents: 7500 })];
    expect(applicableRates(rates, 1500, 3000, false).map((r) => r.id)).toEqual(["light"]);
    expect(applicableRates(rates, 3650, 6800, false)).toMatchObject([{ id: "heavy", priceCents: 995 }]);
    expect(applicableRates(rates, 3650, 7500, false)[0].priceCents).toBe(0);
    expect(applicableRates(rates, 3650, 100, true)[0].priceCents).toBe(0);
  });

  it("extracts VAT from a VAT-inclusive amount", () => {
    expect(includedTaxCents(10600, 600)).toBe(600); // 6% on 100.00
    expect(includedTaxCents(12100, 2100)).toBe(2100); // 21% on 100.00
    expect(includedTaxCents(0, 600)).toBe(0);
  });

  it("computes totals, with VAT null when no rate is configured", () => {
    expect(computeTotals({ lines, discount: discount(), shippingCents: 695, taxRateBps: 600 })).toEqual({ subtotalCents: 6800, discountCents: 680, shippingCents: 695, taxCents: includedTaxCents(6815, 600), totalCents: 6815 });
    expect(computeTotals({ lines, discount: null, shippingCents: 0, taxRateBps: null }).taxCents).toBeNull();
  });

  it("splits an amount into whole cents that always add up", () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateCents(680, [3600, 3200])).toEqual([360, 320]);
    expect(allocateCents(0, [5, 5])).toEqual([0, 0]);
    expect(allocateCents(50, [0, 0])).toEqual([0, 0]);
    for (const total of [1, 7, 999, 12345]) expect(allocateCents(total, [3, 7, 11, 13]).reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("breaks VAT down per line and shipping, adding up to the order's VAT exactly", () => {
    for (const [discountCents, shippingCents, taxRateBps] of [[0, 695, 600], [680, 695, 600], [680, 0, 2100], [333, 1495, 2100], [6800, 695, 600]] as const) {
      const breakdown = taxBreakdown({ lines, discountCents, shippingCents, taxRateBps });
      const total = includedTaxCents(6800 - discountCents + shippingCents, taxRateBps);
      expect(breakdown.lineNetCents.reduce((a, b) => a + b, 0)).toBe(6800 - discountCents);
      expect(breakdown.lineTaxCents.reduce<number>((a, b) => a + (b ?? 0), 0) + (breakdown.shippingTaxCents ?? 0)).toBe(total);
      expect(breakdown.lineTaxCents.every((value) => value !== null && value >= 0)).toBe(true);
    }
    expect(taxBreakdown({ lines, discountCents: 0, shippingCents: 695, taxRateBps: 600 })).toMatchObject({ lineNetCents: [3600, 3200], shippingTaxCents: 39 });
    expect(taxBreakdown({ lines, discountCents: 0, shippingCents: 695, taxRateBps: null })).toEqual({ lineNetCents: [3600, 3200], lineTaxCents: [null, null], shippingTaxCents: null });
  });

  it("formats order numbers", () => {
    expect(orderNumber(1)).toBe("AZZ-1001");
  });
});
