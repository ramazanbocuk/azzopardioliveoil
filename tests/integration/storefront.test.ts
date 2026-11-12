import { beforeEach, describe, expect, it } from "vitest";
import { createServer } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";
import { releaseExpiredReservations } from "@/server/checkout";
import { code, createClient, db, resetDb, seedCatalog } from "../helpers";

const server = createServer(storefrontSchema);
const client = () => createClient(server);

const ADDRESS = { firstName: "Test", lastName: "Customer", line1: "Teststraat 1", postalCode: "1000", city: "Brussels", countryCode: "BE" };
const CHECKOUT = `mutation ($input: CheckoutInput!) { checkout(input: $input) { number status paymentStatus subtotalCents discountCents shippingCents taxCents totalCents items { sku quantity unitPriceCents } } }`;
const REGISTER = `mutation ($input: RegisterInput!) { register(input: $input) { id email } }`;
const account = { email: "Ada@Example.com", password: "a long enough password", firstName: "Ada", lastName: "L" };

let rates: { standardRateId: string; expressRateId: string };

beforeEach(async () => {
  await resetDb();
  rates = await seedCatalog();
});

describe("catalogue", () => {
  it("lists only visible products and never exposes stock counts", async () => {
    const result = await client().gql<{ products: { totalCount: number; nodes: { slug: string; variants: { sku: string; inStock: boolean }[] }[] } }>(
      `{ products { totalCount nodes { slug variants { sku inStock } } } }`,
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.products.nodes.map((p) => p.slug)).toEqual(["evoo"]);
    expect(result.data?.products.nodes[0].variants.find((v) => v.sku === "t-1000")?.inStock).toBe(false);

    const stock = await client().gql(`{ products { nodes { variants { stock } } } }`);
    expect(stock.errors?.[0].message).toMatch(/Cannot query field "stock"/);
  });

  it("hides invisible products from direct lookup", async () => {
    const result = await client().gql<{ product: null }>(`{ product(slug: "hidden") { name } }`);
    expect(result.data?.product).toBeNull();
  });

  it("filters by size and treats search text as data, not SQL", async () => {
    const c = client();
    const sized = await c.gql<{ products: { totalCount: number } }>(`{ products(filter: { volumesMl: [9999] }) { totalCount } }`);
    expect(sized.data?.products.totalCount).toBe(0);
    const injected = await c.gql<{ products: { totalCount: number } }>(`query ($s: String) { products(filter: { search: $s }) { totalCount } }`, { s: `'; DROP TABLE "Product"; --` });
    expect(injected.errors).toBeUndefined();
    expect(injected.data?.products.totalCount).toBe(0);
    expect(await db.product.count()).toBe(2);
  });

  it("only reveals published lots, and only verified documents", async () => {
    const product = await db.product.findUniqueOrThrow({ where: { slug: "evoo" } });
    await db.batch.create({ data: { lotNumber: "AZ-0001", productId: product.id, isPublished: false } });
    await db.batch.create({
      data: { lotNumber: "AZ-0002", productId: product.id, isPublished: true, grove: "Test grove", documents: { create: [{ kind: "ANALYSIS", title: "Unverified", url: "https://example.com/a" }, { kind: "ANALYSIS", title: "Verified", url: "https://example.com/b", verifiedAt: new Date() }] } },
    });
    const c = client();
    const lot = `query ($n: String!) { lot(lotNumber: $n) { lot { grove harvestDate } documents { title } } }`;
    expect((await c.gql<{ lot: null }>(lot, { n: "AZ-0001" })).data?.lot).toBeNull();
    const published = await c.gql<{ lot: { lot: { grove: string; harvestDate: string | null }; documents: { title: string }[] } }>(lot, { n: "az-0002" });
    expect(published.data?.lot.lot).toEqual({ grove: "Test grove", harvestDate: null });
    expect(published.data?.lot.documents.map((d) => d.title)).toEqual(["Verified"]);
  });
});

describe("accounts", () => {
  it("registers, keeps a session in an HttpOnly cookie, and signs out", async () => {
    const c = client();
    const registered = await c.gql<{ register: { email: string } }>(REGISTER, { input: account });
    expect(registered.data?.register.email).toBe("ada@example.com");
    expect(registered.setCookies.find((cookie) => cookie.startsWith("azz_session="))).toMatch(/HttpOnly; SameSite=Lax/);

    const stored = await db.customer.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    const session = await db.customerSession.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(c.jar.get("azz_session")); // only the hash is stored

    expect((await c.gql<{ me: { firstName: string } }>(`{ me { firstName } }`)).data?.me.firstName).toBe("Ada");
    await c.gql(`mutation { logout }`);
    expect((await c.gql<{ me: null }>(`{ me { firstName } }`)).data?.me).toBeNull();
    expect(await db.customerSession.count()).toBe(0);
  });

  it("rejects weak passwords, bad emails and duplicate accounts", async () => {
    const c = client();
    expect(code(await c.gql(REGISTER, { input: { ...account, password: "short" } }))).toBe("BAD_INPUT");
    expect(code(await c.gql(REGISTER, { input: { ...account, email: "not-an-email" } }))).toBe("BAD_INPUT");
    await c.gql(REGISTER, { input: account });
    expect(code(await client().gql(REGISTER, { input: account }))).toBe("EMAIL_TAKEN");
  });

  it("gives the same error for a wrong password and an unknown email, then rate-limits", async () => {
    await client().gql(REGISTER, { input: account });
    const login = `mutation ($e: String!, $p: String!) { login(email: $e, password: $p) { id } }`;
    const c = client();
    const wrong = await c.gql(login, { e: account.email, p: "the wrong password" });
    const unknown = await c.gql(login, { e: "nobody@example.com", p: "the wrong password" });
    expect(code(wrong)).toBe("INVALID_CREDENTIALS");
    expect(unknown.errors?.[0].message).toBe(wrong.errors?.[0].message);

    for (let i = 0; i < 8; i++) await c.gql(login, { e: account.email, p: "the wrong password" });
    expect(code(await c.gql(login, { e: account.email, p: account.password }))).toBe("RATE_LIMITED");
  });

  it("requires a session for customer-only mutations", async () => {
    expect(code(await client().gql(`mutation { toggleFavourite(sku: "t-500") }`))).toBe("UNAUTHENTICATED");
  });
});

describe("cart", () => {
  it("prices from the database and enforces quantity and stock", async () => {
    const c = client();
    const added = await c.gql<{ cartAdd: { itemCount: number; subtotalCents: number } }>(`mutation { cartAdd(sku: "t-500", quantity: 2) { itemCount subtotalCents } }`);
    expect(added.data?.cartAdd).toEqual({ itemCount: 2, subtotalCents: 3600 });
    expect(added.setCookies.some((cookie) => cookie.startsWith("azz_cart="))).toBe(true);

    expect(code(await c.gql(`mutation { cartAdd(sku: "t-1000") { itemCount } }`))).toBe("OUT_OF_STOCK");
    expect(code(await c.gql(`mutation { cartAdd(sku: "h-500") { itemCount } }`))).toBe("NOT_FOUND");
    expect(code(await c.gql(`mutation { cartSetQuantity(sku: "t-500", quantity: 0) { itemCount } }`))).toBe("BAD_INPUT");
    expect(code(await c.gql(`mutation { cartSetQuantity(sku: "t-500", quantity: 11) { itemCount } }`))).toBe("OUT_OF_STOCK");

    // A price change in the database is what the customer pays, whatever the browser believed.
    await db.variant.update({ where: { sku: "t-500" }, data: { priceCents: 2000 } });
    expect((await c.gql<{ cart: { subtotalCents: number } }>(`{ cart { subtotalCents } }`)).data?.cart.subtotalCents).toBe(4000);
  });

  it("keeps carts separate between visitors", async () => {
    await client().gql(`mutation { cartAdd(sku: "t-500") { itemCount } }`);
    expect((await client().gql<{ cart: { itemCount: number } }>(`{ cart { itemCount } }`)).data?.cart.itemCount).toBe(0);
  });

  it("applies valid discount codes and explains invalid ones", async () => {
    await db.discount.createMany({ data: [{ code: "TEN", kind: "PERCENT", value: 10 }, { code: "OLD", kind: "PERCENT", value: 50, endsAt: new Date("2020-01-01") }] });
    const c = client();
    await c.gql(`mutation { cartAdd(sku: "t-750", quantity: 2) { itemCount } }`);
    const applied = await c.gql<{ cartApplyDiscount: { discountCents: number; discountCode: string } }>(`mutation { cartApplyDiscount(code: " ten ") { discountCents discountCode } }`);
    expect(applied.data?.cartApplyDiscount).toEqual({ discountCents: 520, discountCode: "TEN" });
    expect(code(await c.gql(`mutation { cartApplyDiscount(code: "OLD") { discountCents } }`))).toBe("DISCOUNT_INVALID");
    expect(code(await c.gql(`mutation { cartApplyDiscount(code: "NOPE") { discountCents } }`))).toBe("DISCOUNT_INVALID");
  });
});

describe("checkout", () => {
  it("creates an unpaid order with server-computed totals and reserves stock", async () => {
    await db.taxRate.create({ data: { countryCode: "BE", rateBps: 600 } });
    const c = client();
    await c.gql(`mutation { cartAdd(sku: "t-500", quantity: 2) { itemCount } }`);
    const options = await c.gql<{ shippingOptions: { id: string; priceCents: number }[] }>(`{ shippingOptions(countryCode: "be") { id priceCents } }`);
    expect(options.data?.shippingOptions.map((o) => o.priceCents)).toEqual([695, 1495]);

    const placed = await c.gql<{ checkout: { number: string; status: string; paymentStatus: string; taxCents: number; totalCents: number; items: unknown[] } }>(CHECKOUT, {
      input: { email: "Guest@Example.com", shippingRateId: rates.standardRateId, address: ADDRESS },
    });
    expect(placed.errors).toBeUndefined();
    expect(placed.data?.checkout).toMatchObject({ number: "AZZ-1001", status: "PENDING_PAYMENT", paymentStatus: "UNPAID", totalCents: 4295, taxCents: 243 });
    expect(placed.data?.checkout.items).toEqual([{ sku: "t-500", quantity: 2, unitPriceCents: 1800 }]);

    const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
    expect([variant.stock, variant.reserved]).toEqual([10, 2]); // held, not yet sold
    expect((await c.gql<{ cart: { itemCount: number } }>(`{ cart { itemCount } }`)).data?.cart.itemCount).toBe(0);

    // The invoice goes to the delivery address unless told otherwise, and VAT is recorded per line and for shipping.
    const order = await db.order.findFirstOrThrow({ include: { items: true } });
    expect(order).toMatchObject({ billFirstName: order.shipFirstName, billLine1: order.shipLine1, billCountryCode: "BE", billCompany: null, fulfilmentStatus: "UNFULFILLED" });
    expect(order.items[0]).toMatchObject({ taxRateBps: 600, weightGrams: 950, shippedQuantity: 0 });
    expect((order.items[0].taxCents ?? 0) + (order.shippingTaxCents ?? 0)).toBe(order.taxCents);
  });

  it("bills to a separate company address when one is given", async () => {
    const c = client();
    await c.gql(`mutation { cartAdd(sku: "t-500", quantity: 1) { itemCount } }`);
    const billing = { firstName: "Ada", lastName: "Accounts", company: "Trattoria Test BV", vatNumber: "BE0123456789", line1: "Kantoorlaan 9", postalCode: "2000", city: "Antwerp", countryCode: "be" };
    const placed = await c.gql(CHECKOUT, { input: { email: "chef@example.com", shippingRateId: rates.standardRateId, address: ADDRESS, billing } });
    expect(placed.errors).toBeUndefined();
    expect(await db.order.findFirstOrThrow()).toMatchObject({ billCompany: "Trattoria Test BV", billVatNumber: "BE0123456789", billLine1: "Kantoorlaan 9", billCity: "Antwerp", billCountryCode: "BE", shipCity: ADDRESS.city });

    await c.gql(`mutation { cartAdd(sku: "t-500", quantity: 1) { itemCount } }`);
    const bad = await c.gql(CHECKOUT, { input: { email: "chef@example.com", shippingRateId: rates.standardRateId, address: ADDRESS, billing: { ...billing, line1: " " } } });
    expect(code(bad)).toBe("BAD_INPUT");
  });

  it("accepts explicit nulls for optional fields, as a browser client sends them", async () => {
    const c = client();
    await c.gql(`mutation { cartAdd(sku: "t-500") { itemCount } }`);
    const placed = await c.gql<{ checkout: { number: string } }>(CHECKOUT, {
      input: { email: "a@b.co", shippingRateId: rates.standardRateId, customerNote: null, locale: null, address: { ...ADDRESS, line2: null, region: null, phone: null } },
    });
    expect(placed.errors).toBeUndefined();
    expect(placed.data?.checkout.number).toBe("AZZ-1001");
    const registered = await client().gql(REGISTER, { input: { ...account, marketingOptIn: null } });
    expect(registered.errors).toBeUndefined();
  });

  it("leaves VAT empty when no rate is configured for the destination", async () => {
    const c = client();
    await c.gql(`mutation { cartAdd(sku: "t-500") { itemCount } }`);
    const placed = await c.gql<{ checkout: { taxCents: number | null } }>(CHECKOUT, { input: { email: "a@b.co", shippingRateId: rates.expressRateId, address: ADDRESS } });
    expect(placed.data?.checkout.taxCents).toBeNull();
  });

  it("refuses an empty cart, a bad address, and a rate for a country we do not serve", async () => {
    const c = client();
    expect(code(await c.gql(CHECKOUT, { input: { email: "a@b.co", shippingRateId: rates.standardRateId, address: ADDRESS } }))).toBe("CART_EMPTY");
    await c.gql(`mutation { cartAdd(sku: "t-500") { itemCount } }`);
    expect(code(await c.gql(CHECKOUT, { input: { email: "a@b.co", shippingRateId: rates.standardRateId, address: { ...ADDRESS, city: " " } } }))).toBe("BAD_INPUT");
    expect(code(await c.gql(CHECKOUT, { input: { email: "a@b.co", shippingRateId: rates.standardRateId, address: { ...ADDRESS, countryCode: "US" } } }))).toBe("SHIPPING_UNAVAILABLE");
    expect(await db.order.count()).toBe(0);
  });

  it("cannot oversell the last bottle", async () => {
    await db.variant.update({ where: { sku: "t-750" }, data: { stock: 1 } });
    const [a, b] = [client(), client()];
    await a.gql(`mutation { cartAdd(sku: "t-750") { itemCount } }`);
    await b.gql(`mutation { cartAdd(sku: "t-750") { itemCount } }`);
    const input = { email: "a@b.co", shippingRateId: rates.standardRateId, address: ADDRESS };
    const results = await Promise.all([a.gql(CHECKOUT, { input }), b.gql(CHECKOUT, { input })]);
    expect(results.filter((r) => !r.errors)).toHaveLength(1);
    expect(results.map(code).filter(Boolean)).toEqual(["OUT_OF_STOCK"]);
    expect((await db.variant.findUniqueOrThrow({ where: { sku: "t-750" } })).reserved).toBe(1);
    expect(await db.order.count()).toBe(1);
  });

  it("counts discount uses and stops at the limit", async () => {
    await db.discount.create({ data: { code: "ONCE", kind: "FIXED", value: 500, usageLimit: 1 } });
    const input = { email: "a@b.co", shippingRateId: rates.standardRateId, address: ADDRESS };
    const first = client();
    await first.gql(`mutation { cartAdd(sku: "t-500") { itemCount } }`);
    await first.gql(`mutation { cartApplyDiscount(code: "ONCE") { discountCents } }`);
    const order = await first.gql<{ checkout: { discountCents: number; totalCents: number } }>(CHECKOUT, { input });
    expect(order.data?.checkout).toMatchObject({ discountCents: 500, totalCents: 1800 - 500 + 695 });

    const second = client();
    await second.gql(`mutation { cartAdd(sku: "t-500") { itemCount } }`);
    expect(code(await second.gql(`mutation { cartApplyDiscount(code: "ONCE") { discountCents } }`))).toBe("DISCOUNT_INVALID");
  });

  it("releases stock when an unpaid order's reservation expires", async () => {
    const c = client();
    await c.gql(`mutation { cartAdd(sku: "t-500", quantity: 3) { itemCount } }`);
    await c.gql(CHECKOUT, { input: { email: "a@b.co", shippingRateId: rates.standardRateId, address: ADDRESS } });
    expect(await releaseExpiredReservations(db)).toBe(0); // still inside the window
    expect(await releaseExpiredReservations(db, new Date(Date.now() + 41 * 60_000))).toBe(1);
    expect((await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } })).reserved).toBe(0);
    expect((await db.order.findFirstOrThrow()).status).toBe("CANCELLED");
    expect(await releaseExpiredReservations(db, new Date(Date.now() + 41 * 60_000))).toBe(0); // idempotent
  });

  it("shows a guest their order only with the matching email, and customers only their own", async () => {
    const guest = client();
    await guest.gql(`mutation { cartAdd(sku: "t-500") { itemCount } }`);
    await guest.gql(CHECKOUT, { input: { email: "guest@example.com", shippingRateId: rates.standardRateId, address: ADDRESS } });

    const lookup = `query ($n: String!, $e: String!) { order(number: $n, email: $e) { number events { kind } } }`;
    const stranger = client();
    expect((await stranger.gql<{ order: null }>(lookup, { n: "AZZ-1001", e: "other@example.com" })).data?.order).toBeNull();
    expect((await stranger.gql<{ order: { number: string } }>(lookup, { n: "#azz-1001", e: "GUEST@example.com" })).data?.order.number).toBe("AZZ-1001");

    const member = client();
    await member.gql(REGISTER, { input: account });
    await member.gql(`mutation { cartAdd(sku: "t-750") { itemCount } }`);
    await member.gql(CHECKOUT, { input: { email: account.email, shippingRateId: rates.standardRateId, address: ADDRESS } });
    const mine = await member.gql<{ me: { orders: { number: string }[] } }>(`{ me { orders { number } } }`);
    expect(mine.data?.me.orders.map((o) => o.number)).toEqual(["AZZ-1002"]);
  });
});

describe("transport safety", () => {
  it("rejects cross-origin requests and over-deep queries", async () => {
    const c = client();
    const crossSite = await c.gql(`{ me { id } }`, undefined, { origin: "https://evil.example" });
    expect([crossSite.status, code(crossSite)]).toEqual([403, "FORBIDDEN"]);

    const nested = await c.gql(`{ cart { lines { product { variants { sku } reviews { authorFirstName } } } } }`);
    expect(nested.errors).toBeUndefined(); // ordinary nesting is fine

    const tooDeep = await c.gql(`{ __schema { types { fields { type { ofType { ofType { ofType { ofType { ofType { ofType { name } } } } } } } } } } }`);
    expect(tooDeep.errors?.[0].message).toMatch(/too deep/);
  });
});
