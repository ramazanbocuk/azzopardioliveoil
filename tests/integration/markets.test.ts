import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminRole } from "@/generated/prisma/client";
import { createServer } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";
import { allPrices, marketOf, priceIn } from "@/i18n/currency";
import { dashboard, getOrder, paidByCurrency } from "@/server/admin";
import { mustEnrol, requireAdmin, requireStaff, twoFactorRequired } from "@/server/auth";
import { salesReport, vatReport } from "@/server/backoffice";
import { loadCatalog } from "@/server/catalogView";
import type { Ctx } from "@/server/context";
import { deleteMarket, marketsOverview, saveMarket, setExcludedCountries, setVariantPrice } from "@/server/markets";
import { customerRefundEmail } from "@/server/notifications/messages";
import { setPaymentProvider, startPayment, type PaymentProvider } from "@/server/payments";
import { discountProblem, type DiscountRule } from "@/server/pricing";
import { listBackorders } from "@/server/stock";
import { totpCode } from "@/server/totp";
import { beginTotp, confirmTotp, resetTotpFor, securityOverview } from "@/server/twoFactor";
import { code, createClient, db, resetDb, seedCatalog } from "../helpers";

/**
 * Markets, currencies and compulsory two-factor sign-in.
 *
 * The rule under test throughout: an amount is in exactly one currency, set
 * by the delivery country; nothing is ever converted, and amounts in
 * different currencies are never added together.
 */

const server = createServer(storefrontSchema);
const visitor = (shipTo?: string) => {
  const client = createClient(server);
  if (shipTo) client.jar.set("azz_ship", shipTo);
  return client;
};

async function as(role: AdminRole | null): Promise<Ctx> {
  const user = role ? await db.adminUser.create({ data: { email: `${role}-${Math.random().toString(36).slice(2)}@test.local`, name: role, role, passwordHash: "x" } }) : null;
  return { db, ip: "10.9.9.9", userAgent: null, cookies: {}, setCookies: [], customer: null, admin: user };
}
const refused = async (promise: Promise<unknown>, expected: string) => expect(await promise.then(() => "resolved", (error: { code?: string }) => error.code)).toBe(expected);

const CART = `{ cart { currency subtotalCents itemCount lines { sku sold unitPriceCents lineTotalCents } } }`;
const ADD = `mutation ($sku: String!, $quantity: Int) { cartAdd(sku: $sku, quantity: $quantity) { currency subtotalCents lines { sku sold unitPriceCents } } }`;
const OPTIONS = `query ($countryCode: String!) { shippingOptions(countryCode: $countryCode) { id name priceCents } }`;
const CHECKOUT = `mutation ($input: CheckoutInput!) { checkout(input: $input) { number accessToken currency subtotalCents shippingCents totalCents items { sku unitPriceCents } } }`;
const address = (countryCode: string) => ({ firstName: "Test", lastName: "Customer", line1: "1 Test Street", postalCode: "10001", city: "Testville", countryCode });

let rates: { standardRateId: string; expressRateId: string };
let usRateId: string;

/** A United States market in dollars: only the 500 ml has a dollar price; shipping is $15, free from $100. */
beforeEach(async () => {
  await resetDb();
  rates = await seedCatalog();
  await db.market.create({ data: { code: "us", name: "United States", currency: "USD", countries: ["US"] } });
  const small = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
  await db.variantPrice.create({ data: { variantId: small.id, currency: "USD", priceCents: 2100 } });
  const zone = await db.shippingZone.create({ data: { name: "United States", countries: ["US"], currency: "USD", rates: { create: [{ name: "Airmail", priceCents: 1500, freeAboveCents: 10000, position: 0 }] } }, include: { rates: true } });
  usRateId = zone.rates[0].id;
});
afterAll(() => setPaymentProvider(undefined));

describe("the rule", () => {
  it("gives a country its market's currency, euro otherwise, and never invents a price", () => {
    const markets = [{ currency: "USD", countries: ["US"], isActive: true }, { currency: "GBP", countries: ["GB"], isActive: false }];
    expect(marketOf(markets, "US")).toEqual({ currency: "USD", open: true });
    expect(marketOf(markets, "GB")).toEqual({ currency: "GBP", open: false }); // a closed market: no delivery
    expect(marketOf(markets, "BE")).toEqual({ currency: "EUR", open: true }); // in no market: euro
    expect(marketOf(markets, null)).toEqual({ currency: "EUR", open: true });

    const variant = { priceCents: 1800, prices: [{ currency: "USD", priceCents: 2100 }] };
    expect(priceIn(variant, "EUR")).toBe(1800);
    expect(priceIn(variant, "USD")).toBe(2100);
    expect(priceIn(variant, "GBP")).toBeNull(); // no price set: not sold, not converted
    expect(allPrices(variant)).toEqual({ EUR: 1800, USD: 2100 });
    expect(paidByCurrency([{ totalCents: 3600, currency: "EUR" }, { totalCents: 4800, currency: "USD" }, { totalCents: 1000, currency: "EUR" }])).toBe("46.00 EUR; 48.00 USD");

    // A fixed amount or a minimum in one currency does not apply to prices in another; a plain percentage does.
    const rule = (over: Partial<DiscountRule>): DiscountRule => ({ code: "X", kind: "PERCENT", value: 10, minSubtotalCents: 0, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, isActive: true, currency: "EUR", ...over });
    const now = new Date();
    expect(discountProblem(rule({}), 5000, now, "USD")).toBeNull();
    expect(discountProblem(rule({ kind: "FIXED", value: 500 }), 5000, now, "USD")).toBe("This code cannot be used with prices in USD.");
    expect(discountProblem(rule({ minSubtotalCents: 2000 }), 5000, now, "USD")).toBe("This code cannot be used with prices in USD.");
    expect(discountProblem(rule({ kind: "FIXED", value: 500 }), 5000, now, "EUR")).toBeNull();
  });
});

describe("shopping from another market", () => {
  it("prices the cart in the delivery country's currency and will not sell a size that has no price there", async () => {
    const american = visitor("US");
    const added = await american.gql<{ cartAdd: { currency: string; subtotalCents: number; lines: { sku: string; unitPriceCents: number }[] } }>(ADD, { sku: "t-500", quantity: 2 });
    expect(added.data?.cartAdd).toEqual({ currency: "USD", subtotalCents: 4200, lines: [{ sku: "t-500", sold: true, unitPriceCents: 2100 }] });
    // The 750 ml has no dollar price, so it cannot be put in a cart bound for the United States.
    const unsold = await american.gql(ADD, { sku: "t-750", quantity: 1 });
    expect(code(unsold)).toBe("NOT_FOUND");
    expect(unsold.errors?.[0].message).toBe("This size is not sold for delivery to your country.");

    // The same sizes for a Belgian: euro, both sold.
    const belgian = visitor("BE");
    await belgian.gql(ADD, { sku: "t-500", quantity: 1 });
    const euro = await belgian.gql<{ cartAdd: { currency: string; subtotalCents: number } }>(ADD, { sku: "t-750", quantity: 1 });
    expect(euro.data?.cartAdd).toMatchObject({ currency: "EUR", subtotalCents: 4400 });

    // That Belgian now chooses delivery to the United States: the cart is priced again, and the 750 ml counts for nothing.
    belgian.jar.set("azz_ship", "US");
    const repriced = await belgian.gql<{ cart: { currency: string; subtotalCents: number; itemCount: number; lines: { sku: string; sold: boolean; unitPriceCents: number; lineTotalCents: number }[] } }>(CART);
    expect(repriced.data?.cart).toEqual({ currency: "USD", subtotalCents: 2100, itemCount: 2, lines: [{ sku: "t-500", sold: true, unitPriceCents: 2100, lineTotalCents: 2100 }, { sku: "t-750", sold: false, unitPriceCents: 0, lineTotalCents: 0 }] });

    // Without a chosen country, the page's own address decides: en-us is the United States.
    const byAddress = createClient(server);
    expect((await byAddress.gql<{ cartAdd: { currency: string } }>(ADD, { sku: "t-500", quantity: 1 }, { "x-azz-locale": "en-us" })).data?.cartAdd.currency).toBe("USD");
    expect((await byAddress.gql<{ cart: { currency: string } }>(CART, undefined, { "x-azz-locale": "de-de" })).data?.cart.currency).toBe("EUR");
  });

  it("offers shipping in the destination's currency, whatever the visitor was browsing in", async () => {
    const american = visitor("US");
    await american.gql(ADD, { sku: "t-500", quantity: 2 });
    type Options = { shippingOptions: { id: string; name: string; priceCents: number }[] };
    expect((await american.gql<Options>(OPTIONS, { countryCode: "US" })).data?.shippingOptions).toEqual([{ id: usRateId, name: "Airmail", priceCents: 1500 }]);
    // Asked about Belgium, the same cart is priced in euro (2 × €18 = €36, under the €75 threshold).
    expect((await american.gql<Options>(OPTIONS, { countryCode: "BE" })).data?.shippingOptions.map((option) => option.priceCents)).toEqual([695, 1495]);
    // Five bottles are $105: over the $100 threshold, which is a dollar amount.
    await american.gql(ADD, { sku: "t-500", quantity: 3 });
    expect((await american.gql<Options>(OPTIONS, { countryCode: "US" })).data?.shippingOptions[0].priceCents).toBe(0);

    // A euro zone that lists the United States does not serve it: its rates are not dollar amounts.
    await db.shippingZone.deleteMany({ where: { currency: "USD" } });
    await db.shippingZone.updateMany({ where: { currency: "EUR" }, data: { countries: ["BE", "FR", "US"] } });
    expect((await american.gql<Options>(OPTIONS, { countryCode: "US" })).data?.shippingOptions).toEqual([]);
  });

  it("places the order in dollars, at the dollar prices, and asks the payment provider for dollars", async () => {
    const asked: { currency: string; totalCents: number }[] = [];
    const payments: PaymentProvider = {
      name: "STRIPE",
      createCheckout: async ({ order }) => (asked.push({ currency: order.currency, totalCents: order.totalCents }), { providerRef: "cs_test_usd", url: "https://pay.example/usd" }),
      parseWebhook: () => {
        throw new Error("unused");
      },
    };
    setPaymentProvider(payments);

    const american = visitor("US");
    await american.gql(ADD, { sku: "t-500", quantity: 2 });
    type Placed = { checkout: { number: string; accessToken: string; currency: string; subtotalCents: number; shippingCents: number; totalCents: number; items: { sku: string; unitPriceCents: number }[] } };
    const input = { email: "buyer@example.com", shippingRateId: usRateId, address: address("US"), currency: "USD" };

    // Shown euro prices but delivering to the United States: refused, so nobody is charged at prices they did not see.
    const mismatch = await american.gql<Placed>(CHECKOUT, { input: { ...input, currency: "EUR" } });
    expect(code(mismatch)).toBe("BAD_INPUT");
    expect(mismatch.errors?.[0].message).toContain("charged in USD");
    // A euro rate cannot be chosen for a dollar order.
    expect(code(await american.gql<Placed>(CHECKOUT, { input: { ...input, shippingRateId: rates.standardRateId } }))).toBe("SHIPPING_UNAVAILABLE");
    expect(await db.order.count()).toBe(0);

    const placed = await american.gql<Placed>(CHECKOUT, { input });
    expect(placed.errors).toBeUndefined();
    expect(placed.data?.checkout).toMatchObject({ currency: "USD", subtotalCents: 4200, shippingCents: 1500, totalCents: 5700, items: [{ sku: "t-500", unitPriceCents: 2100 }] });
    const order = await db.order.findFirstOrThrow({ include: { items: true } });
    expect(order).toMatchObject({ currency: "USD", totalCents: 5700, shipCountryCode: "US", taxCents: null }); // no VAT rate is set for the United States, and none is invented

    const ctx: Ctx = { db, ip: "10.1.1.1", userAgent: null, cookies: {}, setCookies: [], customer: null, admin: null };
    expect(await startPayment(ctx, placed.data!.checkout.number, placed.data!.checkout.accessToken)).toEqual({ url: "https://pay.example/usd" });
    expect(asked).toEqual([{ currency: "USD", totalCents: 5700 }]);
    expect(await db.payment.findFirstOrThrow()).toMatchObject({ currency: "USD", amountCents: 5700 });

    // The customer's emails state dollars, in the format of the language they shopped in.
    expect(customerRefundEmail({ ...order, locale: "en-us" }, 2100, false).text).toContain("$21.00");
    expect(customerRefundEmail({ ...order, locale: "de-de" }, 2100, false).text.replace(/\s/g, " ")).toContain("21,00 $");
  });

  it("refuses a cart with a size not sold there, a product excluded from the country, and a closed market", async () => {
    const boss = await as("ADMINISTRATOR");
    const product = await db.product.findUniqueOrThrow({ where: { slug: "evoo" } });
    type Placed = { checkout: { number: string } };

    // A size with no dollar price, in a cart that is then sent to the United States.
    const mixed = visitor("BE");
    await mixed.gql(ADD, { sku: "t-750", quantity: 1 });
    const unsold = await mixed.gql<Placed>(CHECKOUT, { input: { email: "a@example.com", shippingRateId: usRateId, address: address("US") } });
    expect(code(unsold)).toBe("SHIPPING_UNAVAILABLE");
    expect(unsold.errors?.[0].message).toBe("Test Oil 750 ml is not sold for delivery to this country. Remove it from your cart to continue.");

    // A product the owner will not send to France.
    await refused(setExcludedCountries(await as("STAFF"), product.id, ["FR"]), "FORBIDDEN");
    await setExcludedCountries(boss, product.id, ["fr", "FR"]);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).excludedCountries).toEqual(["FR"]);
    const french = await mixed.gql<Placed>(CHECKOUT, { input: { email: "a@example.com", shippingRateId: rates.standardRateId, address: address("FR") } });
    expect(french.errors?.[0].message).toBe("Test Oil 750 ml cannot be sent to this country. Remove it from your cart to continue.");
    expect((await mixed.gql<Placed>(CHECKOUT, { input: { email: "a@example.com", shippingRateId: rates.standardRateId, address: address("BE") } })).errors).toBeUndefined();

    // The market is closed: nothing is delivered to its countries.
    const market = await db.market.findUniqueOrThrow({ where: { code: "us" } });
    await saveMarket(boss, market.id, { code: "us", name: "United States", currency: "USD", countries: ["US"], isActive: false });
    const american = visitor("US");
    await american.gql(ADD, { sku: "t-500", quantity: 1 });
    expect((await american.gql<{ shippingOptions: unknown[] }>(OPTIONS, { countryCode: "US" })).data?.shippingOptions).toEqual([]);
    const closed = await american.gql<Placed>(CHECKOUT, { input: { email: "a@example.com", shippingRateId: usRateId, address: address("US") } });
    expect(closed.errors?.[0].message).toBe("We do not deliver to this country at the moment.");
    expect(await db.order.count()).toBe(1);
  });

  it("gives the catalogue every price that was set, and the assistant's data no converted price", async () => {
    const { products } = await loadCatalog(db, "en");
    const sizes = Object.fromEntries(products[0].variants.map((variant) => [variant.sku, variant.prices]));
    expect(sizes).toEqual({ "t-500": { EUR: 1800, USD: 2100 }, "t-750": { EUR: 2600 }, "t-1000": { EUR: 3200 } });
  });
});

describe("the admin", () => {
  it("lets only an administrator define markets, keeps a country in one market, and shows what would stop a sale", async () => {
    const [boss, manager, staff] = [await as("ADMINISTRATOR"), await as("OPERATIONS_MANAGER"), await as("STAFF")];
    const uk = { code: "uk", name: "United Kingdom", currency: "GBP", countries: ["gb"], isActive: true };
    await refused(saveMarket(manager, null, uk), "FORBIDDEN");
    await refused(saveMarket(boss, null, { ...uk, currency: "CHF" }), "BAD_INPUT");
    await refused(saveMarket(boss, null, { ...uk, countries: ["GB", "US"] }), "BAD_INPUT"); // the United States is already in a market
    await refused(saveMarket(boss, null, { ...uk, code: "us" }), "BAD_INPUT");
    const market = await saveMarket(boss, null, uk);
    expect(market).toMatchObject({ code: "uk", currency: "GBP", countries: ["GB"] });

    // Prices in other currencies: a manager of the catalogue types them in; the euro price is not set here.
    const small = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
    await refused(setVariantPrice(staff, small.id, "GBP", 1600), "FORBIDDEN");
    await refused(setVariantPrice(manager, small.id, "EUR", 1600), "BAD_INPUT");
    await refused(setVariantPrice(manager, small.id, "GBP", 0), "BAD_INPUT");
    await setVariantPrice(manager, small.id, "GBP", 1600);
    await setVariantPrice(manager, small.id, "GBP", 1650); // changed, not duplicated
    expect(await db.variantPrice.findMany({ where: { variantId: small.id }, orderBy: { currency: "asc" }, select: { currency: true, priceCents: true } })).toEqual([{ currency: "GBP", priceCents: 1650 }, { currency: "USD", priceCents: 2100 }]);

    const overview = await marketsOverview(manager);
    expect(overview.base).toEqual({ currency: "EUR", countries: ["BE", "FR"] });
    expect(overview.markets.map((entry) => ({ code: entry.code, without: entry.countriesWithoutShipping, priced: entry.sizesPriced, unpriced: entry.sizesWithoutPrice.length }))).toEqual([
      { code: "us", without: [], priced: 1, unpriced: 2 }, // the 750 ml and the 1000 ml have no dollar price
      { code: "uk", without: ["GB"], priced: 1, unpriced: 2 }, // and no pound shipping zone exists yet: nothing can be delivered there
    ]);
    expect(overview.sizesOnSale).toBe(3);

    // Removing the price stops the size being sold in that currency; removing the market returns its countries to euro.
    await setVariantPrice(manager, small.id, "GBP", null);
    expect(await db.variantPrice.count({ where: { currency: "GBP" } })).toBe(0);
    await refused(deleteMarket(manager, market.id), "FORBIDDEN");
    await deleteMarket(boss, market.id);
    expect((await marketsOverview(boss)).markets.map((entry) => entry.code)).toEqual(["us"]);
    expect((await db.auditLog.findMany({ where: { action: { startsWith: "market." } }, orderBy: { createdAt: "asc" }, select: { action: true } })).map((row) => row.action)).toEqual(["market.create", "market.delete"]);
  });

  it("reports one currency at a time and never adds dollars to euro", async () => {
    const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
    const paid = (number: string, currency: string, totalCents: number, country: string) =>
      db.order.create({
        data: {
          number,
          currency,
          email: `${number}@example.com`,
          status: "PAID",
          paymentStatus: "PAID",
          paidAt: new Date(),
          subtotalCents: totalCents,
          shippingCents: 0,
          totalCents,
          shippingRateName: "Standard",
          weightGrams: 950,
          shipFirstName: "Test",
          shipLastName: "Customer",
          shipLine1: "1 Test Street",
          shipPostalCode: "1000",
          shipCity: "Testville",
          shipCountryCode: country,
          billFirstName: "Test",
          billLastName: "Customer",
          billLine1: "1 Test Street",
          billPostalCode: "1000",
          billCity: "Testville",
          billCountryCode: country,
          items: { create: [{ variantId: variant.id, sku: "t-500", productName: "Test Oil", variantLabel: "500 ml", unitPriceCents: totalCents, quantity: 1, lineTotalCents: totalCents }] },
          payments: { create: [{ provider: "STRIPE", providerRef: `cs_${number}`, status: "PAID", amountCents: totalCents, currency }] },
        },
      });
    await paid("AZZ-30001", "EUR", 3600, "BE");
    await paid("AZZ-30002", "EUR", 1800, "FR");
    const dollars = await paid("AZZ-30003", "USD", 4200, "US");
    const boss = await as("ADMINISTRATOR");

    const euro = await salesReport(boss, {});
    expect(euro).toMatchObject({ currency: "EUR", currencies: ["EUR", "USD"], orders: 2, grossCents: 5400, units: 2 });
    expect(euro.countries.map((row) => row.country).sort()).toEqual(["BE", "FR"]);
    const usd = await salesReport(boss, { currency: "USD" });
    expect(usd).toMatchObject({ currency: "USD", orders: 1, grossCents: 4200 });
    expect(usd.countries).toEqual([{ country: "US", orders: 1, grossCents: 4200 }]);
    expect((await salesReport(boss, { currency: "XXX" })).currency).toBe("EUR"); // an unknown currency is not a report

    expect(await vatReport(boss, {})).toMatchObject({ currency: "EUR", grossCents: 5400 });
    expect(await vatReport(boss, { currency: "USD" })).toMatchObject({ currency: "USD", grossCents: 4200, ordersWithoutRate: 1 });

    const board = await dashboard(boss);
    expect(board).toMatchObject({ currency: "EUR", revenueCents: 5400, paidOrders: 2, averageOrderCents: 2700, otherCurrencies: [{ currency: "USD", paidOrders: 1, revenueCents: 4200 }] });
    expect((await marketsOverview(boss)).paidOrders).toEqual([{ currency: "EUR", orders: 2, totalCents: 5400 }, { currency: "USD", orders: 1, totalCents: 4200 }]);
    expect((await getOrder(boss, dollars.id)).currency).toBe("USD");
  });
});

describe("two-factor sign-in for staff", () => {
  const required = { NODE_ENV: "test", ADMIN_TWO_FACTOR: "required" };
  const original = process.env.ADMIN_TWO_FACTOR;
  afterAll(() => {
    if (original === undefined) delete process.env.ADMIN_TWO_FACTOR;
    else process.env.ADMIN_TWO_FACTOR = original;
  });

  it("is always compulsory in production, and elsewhere only when asked for", () => {
    expect(twoFactorRequired({ NODE_ENV: "production" })).toBe(true);
    expect(twoFactorRequired({ NODE_ENV: "production", ADMIN_TWO_FACTOR: "optional" })).toBe(true); // there is no off switch in production
    expect(twoFactorRequired({ NODE_ENV: "development" })).toBe(false);
    expect(twoFactorRequired(required)).toBe(true);
    expect(mustEnrol({ totpEnabledAt: null }, { NODE_ENV: "production" })).toBe(true);
    expect(mustEnrol({ totpEnabledAt: new Date() }, { NODE_ENV: "production" })).toBe(false);
  });

  it("lets a person without a second factor do one thing: set one up", async () => {
    const boss = await as("ADMINISTRATOR");
    const other = await as("STAFF");
    process.env.ADMIN_TWO_FACTOR = "required";
    const secretBefore = process.env.APP_SECRET;
    process.env.APP_SECRET = "test-only-secret-test-only-secret-0123"; // seals the authenticator key at rest
    try {
      // Every part of the panel is closed, whatever the role.
      expect(() => requireAdmin(boss, "VIEW", "orders")).toThrow("Set up two-factor sign-in before using the admin panel");
      expect(() => requireStaff(boss)).toThrow("Set up two-factor sign-in");
      await refused(listBackorders(boss), "FORBIDDEN");
      await refused(dashboard(boss), "FORBIDDEN");
      await refused(marketsOverview(boss), "FORBIDDEN");
      // Including the administrator's powers over other people's sign-in.
      await refused(resetTotpFor(boss, other.admin!.id), "FORBIDDEN");

      // Setting it up is open: begin, then prove the app shows the right code.
      expect((await securityOverview(boss)).me).toMatchObject({ totpOn: false, pending: null });
      const { secret } = await beginTotp(boss);
      // Each request reads the account afresh; here that is done by hand.
      const started: Ctx = { ...boss, admin: await db.adminUser.findUniqueOrThrow({ where: { id: boss.admin!.id } }) };
      await refused(confirmTotp(started, "000000"), "BAD_INPUT");
      await refused(dashboard(started), "FORBIDDEN"); // started is not finished
      await confirmTotp(started, totpCode(secret, Date.now()));

      // The next request carries the account as it now is, and the panel opens.
      const enrolled: Ctx = { ...boss, admin: await db.adminUser.findUniqueOrThrow({ where: { id: boss.admin!.id } }) };
      expect(enrolled.admin!.totpEnabledAt).not.toBeNull();
      expect((await dashboard(enrolled)).currency).toBe("EUR");
      expect(requireStaff(enrolled).id).toBe(boss.admin!.id);
      // The role still decides the rest.
      const enrolledStaff: Ctx = { ...other, admin: await db.adminUser.update({ where: { id: other.admin!.id }, data: { totpEnabledAt: new Date() } }) };
      await refused(saveMarket(enrolledStaff, null, { code: "x", name: "Test", currency: "GBP", countries: ["GB"] }), "FORBIDDEN");
    } finally {
      delete process.env.ADMIN_TWO_FACTOR;
      if (secretBefore === undefined) delete process.env.APP_SECRET;
      else process.env.APP_SECRET = secretBefore;
    }
    // Where it is not required (this test run), an account without one works as before.
    expect((await dashboard(boss)).currency).toBe("EUR");
  });
});
