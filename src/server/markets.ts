import { z } from "zod";
import { LOCALES, SHIP_COOKIE, isLocale } from "@/i18n/config";
import { BASE_CURRENCY, CURRENCIES, isCurrency, marketOf, priceIn, type Currency, type MarketRule } from "@/i18n/currency";
import { requireAdmin } from "./auth";
import type { Ctx } from "./context";
import type { Db } from "./db";
import { AppError, parse } from "./errors";

/**
 * Markets and currencies.
 *
 * A market is a group of delivery countries sold to in one currency. The
 * euro is the base: a country in no market is sold to in euro, at the price
 * on the variant. Other currencies have their own prices, typed in by the
 * owner (`VariantPrice`).
 *
 * Nothing is ever converted. A size with no price in a currency is simply
 * not sold in that currency, and reports never add two currencies together.
 *
 * The currency follows the DELIVERY country, not the language: a visitor
 * reading German who has a parcel sent to New York pays in dollars.
 */

export { BASE_CURRENCY, CURRENCIES, allPrices, isCurrency, marketOf, priceIn, toCurrency, type Currency, type MarketRule } from "@/i18n/currency";

export const listMarketRules = (db: Db): Promise<MarketRule[]> => db.market.findMany({ select: { currency: true, countries: true, isActive: true }, orderBy: { position: "asc" } });

export async function marketFor(db: Db, country: string | null | undefined) {
  return marketOf(await listMarketRules(db), country);
}

/**
 * The currency this visitor is shown: that of the delivery country they
 * chose, else that of the country their page address names (en-us, en-gb),
 * else euro. The checkout decides again from the address actually entered.
 */
export async function currencyOf(ctx: Ctx): Promise<Currency> {
  const chosen = ctx.cookies[SHIP_COOKIE];
  const country = chosen && /^[A-Z]{2}$/.test(chosen) ? chosen : isLocale(ctx.locale) ? LOCALES[ctx.locale].country : null;
  return (await marketFor(ctx.db, country)).currency;
}

// ───────────────────────────── admin ─────────────────────────────

const audit = (ctx: Ctx, action: string, entity: string, entityId: string | null, data?: object) => ctx.db.auditLog.create({ data: { actorType: "admin", actorId: ctx.admin?.id ?? null, action, entity, entityId, data, ip: ctx.ip } });

const countryList = z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use two-letter country codes, such as US or GB.")).max(250);
const marketInput = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.").max(40),
  name: z.string().trim().min(2, "Give the market a name.").max(80),
  currency: z.enum(CURRENCIES),
  countries: countryList.min(1, "List at least one country."),
  isActive: z.boolean().default(true),
});

/**
 * Everything the markets screen shows, including what would stop a sale:
 * a country with no shipping zone in its currency, and sizes on sale with no
 * price in a market's currency.
 */
export async function marketsOverview(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "settings");
  const [markets, zones, variants, orders] = await Promise.all([
    ctx.db.market.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] }),
    ctx.db.shippingZone.findMany({ where: { isActive: true }, select: { name: true, countries: true, currency: true } }),
    ctx.db.variant.findMany({ where: { isActive: true, product: { isVisible: true, deletedAt: null } }, select: { sku: true, label: true, priceCents: true, prices: true, product: { select: { name: true } } }, orderBy: [{ product: { name: "asc" } }, { position: "asc" }] }),
    ctx.db.order.groupBy({ by: ["currency"], where: { paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } }, _count: true, _sum: { totalCents: true } }),
  ]);
  const taken = new Set(markets.flatMap((market) => market.countries));
  const served = (country: string, currency: string) => zones.some((zone) => zone.currency === currency && zone.countries.includes(country));
  return {
    base: {
      currency: BASE_CURRENCY,
      // Every country a euro shipping zone serves that no market has claimed.
      countries: [...new Set(zones.filter((zone) => zone.currency === BASE_CURRENCY).flatMap((zone) => zone.countries))].filter((country) => !taken.has(country)).sort(),
    },
    markets: markets.map((market) => ({
      ...market,
      countriesWithoutShipping: market.countries.filter((country) => !served(country, market.currency)),
      sizesWithoutPrice: market.currency === BASE_CURRENCY ? [] : variants.filter((variant) => priceIn(variant, market.currency) === null).map((variant) => `${variant.product.name} ${variant.label} (${variant.sku})`),
      sizesPriced: variants.filter((variant) => priceIn(variant, market.currency) !== null).length,
    })),
    sizesOnSale: variants.length,
    // Zones written in a currency that none of their countries is sold to in: their rates can never apply.
    strandedZones: zones.filter((zone) => !zone.countries.some((country) => marketOf(markets, country).currency === zone.currency)).map((zone) => `${zone.name} (${zone.currency})`),
    paidOrders: orders.map((row) => ({ currency: row.currency, orders: row._count, totalCents: row._sum.totalCents ?? 0 })).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

/** Creating or changing a market changes what customers are charged and in which currency: administrators only. */
export async function saveMarket(ctx: Ctx, id: string | null, input: unknown) {
  requireAdmin(ctx, "ADMINISTRATOR", "settings");
  const data = parse(marketInput, input);
  const countries = [...new Set(data.countries)].sort();
  const others = await ctx.db.market.findMany({ where: id ? { NOT: { id } } : {} });
  if (others.some((market) => market.code === data.code)) throw new AppError("BAD_INPUT", "Another market already uses this code.", "code");
  const clash = others.flatMap((market) => market.countries.filter((country) => countries.includes(country)).map((country) => `${country} (in ${market.name})`));
  if (clash.length > 0) throw new AppError("BAD_INPUT", `A country can be in one market only: ${clash.join(", ")}.`, "countries");
  const value = { code: data.code, name: data.name, currency: data.currency, countries, isActive: data.isActive };
  const market = id ? await ctx.db.market.update({ where: { id }, data: value }).catch(() => null) : await ctx.db.market.create({ data: { ...value, position: others.length } });
  if (!market) throw new AppError("NOT_FOUND", "Market not found.");
  await audit(ctx, id ? "market.update" : "market.create", "Market", market.id, value);
  return market;
}

/** Removing a market returns its countries to the euro base. Orders already placed keep their currency. */
export async function deleteMarket(ctx: Ctx, id: string) {
  requireAdmin(ctx, "ADMINISTRATOR", "settings");
  const market = await ctx.db.market.delete({ where: { id } }).catch(() => null);
  if (!market) throw new AppError("NOT_FOUND", "Market not found.");
  await audit(ctx, "market.delete", "Market", id, { code: market.code, currency: market.currency, countries: market.countries });
}

const priceInput = z.union([z.number().int().min(1, "A price must be more than zero.").max(10_000_000), z.null()]);

/** The price of one size in a currency other than euro. Null removes it, which stops that size being sold in that currency. */
export async function setVariantPrice(ctx: Ctx, variantId: string, currency: string, input: unknown) {
  requireAdmin(ctx, "MANAGER", "catalog");
  if (!isCurrency(currency) || currency === BASE_CURRENCY) throw new AppError("BAD_INPUT", "The euro price is the size's own price; set other currencies here.");
  const priceCents = parse(priceInput, input);
  const variant = await ctx.db.variant.findUnique({ where: { id: variantId }, select: { id: true, sku: true } });
  if (!variant) throw new AppError("NOT_FOUND", "That size no longer exists.");
  if (priceCents === null) await ctx.db.variantPrice.deleteMany({ where: { variantId, currency } });
  else await ctx.db.variantPrice.upsert({ where: { variantId_currency: { variantId, currency } }, create: { variantId, currency, priceCents }, update: { priceCents } });
  await audit(ctx, "variant.price", "Variant", variantId, { sku: variant.sku, currency, priceCents });
}

/** Countries one product may not be sent to. */
export async function setExcludedCountries(ctx: Ctx, productId: string, input: unknown) {
  requireAdmin(ctx, "MANAGER", "catalog");
  const countries = [...new Set(parse(countryList, input))].sort();
  const product = await ctx.db.product.update({ where: { id: productId }, data: { excludedCountries: countries } }).catch(() => null);
  if (!product) throw new AppError("NOT_FOUND", "Product not found.");
  await audit(ctx, "product.excluded_countries", "Product", productId, { countries });
}
