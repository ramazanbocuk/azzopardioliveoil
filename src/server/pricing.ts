import { roundToStep, smallestStep } from "@/i18n/currency";

/**
 * Pure pricing rules. No database, no clock of its own — everything is passed
 * in, so every rule here is unit-tested directly. The server is the only
 * place totals are computed; the browser displays what it is told.
 */

export type Line = { unitPriceCents: number; quantity: number; weightGrams: number };

export type DiscountRule = {
  code: string;
  kind: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value: number;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  /** The currency of a FIXED value and of the minimum. Absent on rules that are a percentage only. */
  currency?: string;
};

export type RateRule = {
  id: string;
  name: string;
  carrier: string | null;
  priceCents: number;
  minWeightGrams: number;
  maxWeightGrams: number | null;
  freeAboveCents: number | null;
  estimate: string | null;
};

export const MAX_LINE_QUANTITY = 24;

export function subtotalCents(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

export function totalWeightGrams(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.weightGrams * line.quantity, 0);
}

/** Returns why a code cannot be used, or null when it can. */
export function discountProblem(discount: DiscountRule, subtotal: number, now: Date, currency = "EUR"): string | null {
  if (!discount.isActive) return "This code is not active.";
  // An amount in one currency means nothing against prices in another, and is never converted.
  if (discount.currency && discount.currency !== currency && (discount.kind === "FIXED" || discount.minSubtotalCents > 0)) return `This code cannot be used with prices in ${currency}.`;
  if (discount.startsAt && now < discount.startsAt) return "This code is not valid yet.";
  if (discount.endsAt && now > discount.endsAt) return "This code has expired.";
  if (discount.usageLimit !== null && discount.usedCount >= discount.usageLimit) return "This code has been fully used.";
  if (subtotal < discount.minSubtotalCents) return "Your order does not reach the minimum for this code.";
  return null;
}

export function discountAmount(discount: DiscountRule | null, subtotal: number, currency = "EUR"): { discountCents: number; freeShipping: boolean } {
  if (!discount) return { discountCents: 0, freeShipping: false };
  switch (discount.kind) {
    case "PERCENT":
      // A percentage of a yen or won price is rounded to a whole unit: there is nothing smaller to charge.
      return { discountCents: roundToStep((subtotal * Math.min(100, Math.max(0, discount.value))) / 100, currency), freeShipping: false };
    case "FIXED":
      return { discountCents: Math.min(subtotal, Math.max(0, discount.value)), freeShipping: false };
    case "FREE_SHIPPING":
      return { discountCents: 0, freeShipping: true };
  }
}

/** Rates whose weight band fits the parcel, priced for this order. */
export function applicableRates(rates: RateRule[], weightGrams: number, goodsCents: number, freeShipping: boolean) {
  return rates
    .filter((rate) => weightGrams >= rate.minWeightGrams && (rate.maxWeightGrams === null || weightGrams <= rate.maxWeightGrams))
    .map((rate) => {
      const free = freeShipping || (rate.freeAboveCents !== null && goodsCents >= rate.freeAboveCents);
      return { id: rate.id, name: rate.name, carrier: rate.carrier, estimate: rate.estimate, priceCents: free ? 0 : rate.priceCents };
    });
}

/** VAT contained in a VAT-inclusive amount. `rateBps` is percent × 100 (6% = 600). */
export function includedTaxCents(grossCents: number, rateBps: number, currency = "EUR"): number {
  return roundToStep((grossCents * rateBps) / (10000 + rateBps), currency);
}

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  /** Null when no VAT rate is configured for the destination. */
  taxCents: number | null;
  totalCents: number;
};

/**
 * Displayed prices include VAT, so the total is goods − discount + shipping
 * and VAT is the portion contained in it. One rate is applied to goods and
 * shipping alike — to be confirmed with the accountant per destination.
 */
export function computeTotals(input: { lines: Line[]; discount: DiscountRule | null; shippingCents: number; taxRateBps: number | null; currency?: string }): Totals {
  const subtotal = subtotalCents(input.lines);
  const { discountCents } = discountAmount(input.discount, subtotal, input.currency);
  const totalCents = subtotal - discountCents + input.shippingCents;
  return {
    subtotalCents: subtotal,
    discountCents,
    shippingCents: input.shippingCents,
    taxCents: input.taxRateBps === null ? null : includedTaxCents(totalCents, input.taxRateBps, input.currency),
    totalCents,
  };
}

/** Splits `total` across `weights` in whole cents (whole units for yen and won: `step` 100), so the parts always add up to the total exactly. */
export function allocateCents(total: number, weights: number[], step = 1): number[] {
  if (step > 1) return allocateCents(Math.round(total / step), weights).map((part) => part * step);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (left <= 0) break;
    parts[index] += 1;
    left -= 1;
  }
  return parts;
}

export type TaxBreakdown = {
  /** What each line costs after its share of the discount, VAT included. */
  lineNetCents: number[];
  /** VAT contained in each line. Null when no rate applies. */
  lineTaxCents: (number | null)[];
  shippingTaxCents: number | null;
};

/**
 * VAT per line, for invoices and accounting. The parts always add up to the
 * order's `taxCents`: VAT on shipping is taken first, and the rest is shared
 * across lines by what each costs after discount.
 */
export function taxBreakdown(input: { lines: Line[]; discountCents: number; shippingCents: number; taxRateBps: number | null; currency?: string }): TaxBreakdown {
  const step = smallestStep(input.currency ?? "EUR");
  const gross = input.lines.map((line) => line.unitPriceCents * line.quantity);
  const discounts = allocateCents(input.discountCents, gross, step);
  const lineNetCents = gross.map((amount, index) => amount - discounts[index]);
  if (input.taxRateBps === null) return { lineNetCents, lineTaxCents: lineNetCents.map(() => null), shippingTaxCents: null };

  const goods = lineNetCents.reduce((a, b) => a + b, 0);
  const totalTax = includedTaxCents(goods + input.shippingCents, input.taxRateBps, input.currency);
  const shippingTaxCents = Math.min(totalTax, includedTaxCents(input.shippingCents, input.taxRateBps, input.currency));
  return { lineNetCents, lineTaxCents: allocateCents(totalTax - shippingTaxCents, lineNetCents, step), shippingTaxCents };
}

export function orderNumber(sequence: number): string {
  return `AZZ-${1000 + sequence}`;
}
