/**
 * Currencies and the rule that picks one. Pure, so the server and the page
 * apply exactly the same rule. See src/server/markets.ts for what a market is.
 */

export const CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const BASE_CURRENCY: Currency = "EUR";
export const isCurrency = (value: string | null | undefined): value is Currency => !!value && (CURRENCIES as readonly string[]).includes(value);
export const toCurrency = (value: string | null | undefined): Currency => (isCurrency(value) ? value : BASE_CURRENCY);

export type MarketRule = { currency: string; countries: string[]; isActive: boolean };

/** The currency a country is sold to in, and whether we sell there at all. A country in no market is sold to in euro. */
export function marketOf(markets: MarketRule[], country: string | null | undefined): { currency: Currency; open: boolean } {
  const market = country ? markets.find((entry) => entry.countries.includes(country)) : undefined;
  if (!market) return { currency: BASE_CURRENCY, open: true };
  return { currency: toCurrency(market.currency), open: market.isActive };
}

type Priced = { priceCents: number; prices?: { currency: string; priceCents: number }[] };

/** What a size costs in a currency, or null when the owner has set no price in it. Never a conversion. */
export function priceIn(variant: Priced, currency: string): number | null {
  if (currency === BASE_CURRENCY) return variant.priceCents;
  return variant.prices?.find((price) => price.currency === currency)?.priceCents ?? null;
}

/** Every price of a size, by currency. The page picks one; it does not calculate. */
export function allPrices(variant: Priced): Record<string, number> {
  return Object.fromEntries([[BASE_CURRENCY, variant.priceCents], ...(variant.prices ?? []).filter((price) => isCurrency(price.currency)).map((price) => [price.currency, price.priceCents])]);
}
