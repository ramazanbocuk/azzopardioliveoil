import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminRole } from "@/generated/prisma/client";
import { createServer } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";
import * as admin from "@/server/admin";
import { adminLogin } from "@/server/auth";
import * as backoffice from "@/server/backoffice";
import type { Ctx } from "@/server/context";
import { hashPassword } from "@/server/crypto";
import { AppError } from "@/server/errors";
import { integrationStatus } from "@/server/integrations";
import { base32Decode, base32Encode, openSecret, sealSecret, totpCode, verifyTotp } from "@/server/totp";
import { beginTotp, confirmTotp, disableTotp, resetTotpFor, revokeSession, securityOverview } from "@/server/twoFactor";
import { BILL, code, createClient, db, resetDb, seedCatalog } from "../helpers";

const server = createServer(storefrontSchema);
const SECRET = "test-secret-that-is-at-least-32-characters-long";
const previousSecret = process.env.APP_SECRET;

async function as(role: AdminRole, password?: string): Promise<Ctx> {
  const user = await db.adminUser.create({ data: { email: `${role}-${Math.random().toString(36).slice(2)}@test.local`.toLowerCase(), name: role, role, passwordHash: password ? await hashPassword(password) : "x" } });
  return { db, ip: "10.9.9.9", userAgent: "Mozilla/5.0 (Macintosh) Chrome/130", cookies: {}, setCookies: [], customer: null, admin: user };
}
const anonymous = (): Ctx => ({ db, ip: `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, userAgent: "test", cookies: {}, setCookies: [], customer: null, admin: null });

async function refused(promise: Promise<unknown>, expected: string | RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  if (typeof expected === "string") expect((error as AppError).code).toBe(expected);
  else expect((error as AppError).message).toMatch(expected);
}

async function order(over: { country?: string; total?: number; taxRateBps?: number | null; paidAt?: Date | null; email?: string; lot?: string | null; code?: string | null; discount?: number } = {}) {
  const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
  const total = over.total ?? 4295;
  const rate = over.taxRateBps === undefined ? 600 : over.taxRateBps;
  const paidAt = over.paidAt === undefined ? new Date() : over.paidAt;
  return db.order.create({
    data: {
      ...BILL,
      shipFirstName: "Ada",
      shipLastName: "Buyer",
      shipLine1: "Hoofdstraat 5",
      shipPostalCode: "2000",
      shipCity: "Antwerp",
      shipCountryCode: over.country ?? "BE",
      email: over.email ?? "ada@example.com",
      status: paidAt ? "PAID" : "PENDING_PAYMENT",
      paymentStatus: paidAt ? "PAID" : "UNPAID",
      paidAt,
      subtotalCents: total - 695,
      discountCents: over.discount ?? 0,
      discountCode: over.code ?? null,
      shippingCents: 695,
      taxRateBps: rate,
      taxCents: rate === null ? null : Math.round((total * rate) / (10000 + rate)),
      shippingTaxCents: rate === null ? null : Math.round((695 * rate) / (10000 + rate)),
      totalCents: total,
      shippingRateName: "Standard",
      weightGrams: 1900,
      number: `AZZ-${Math.floor(Math.random() * 90000) + 10000}`,
      items: { create: [{ variantId: variant.id, sku: "t-500", productName: "Test Oil", variantLabel: "500 ml", unitPriceCents: 1800, quantity: 2, lineTotalCents: 3600, weightGrams: 950, lotNumber: over.lot ?? null, shippedQuantity: over.lot ? 2 : 0 }] },
      payments: paidAt ? { create: [{ provider: "STRIPE", providerRef: `cs_${Math.random().toString(36).slice(2)}`, status: "PAID", amountCents: total, method: "card" }] } : undefined,
    },
    include: { payments: true, items: true },
  });
}

beforeEach(async () => {
  process.env.APP_SECRET = SECRET;
  await resetDb();
  await seedCatalog();
});
afterAll(() => {
  process.env.APP_SECRET = previousSecret;
});

describe("reports", () => {
  it("clamps and orders reporting periods", () => {
    const now = new Date("2026-11-13T10:00:00Z");
    expect(backoffice.period({}, now)).toMatchObject({ fromText: "2026-11-01", toText: "2026-11-13" });
    expect(backoffice.period({ from: "2026-03-10", to: "2026-03-01" }, now)).toMatchObject({ fromText: "2026-03-01", toText: "2026-03-10" });
    expect(backoffice.period({ from: "not-a-date", to: "2026-13-45" }, now)).toMatchObject({ fromText: "2026-11-01", toText: "2026-11-13" });
    expect(backoffice.period({ from: "2010-01-01", to: "2026-11-13" }, now).fromText).toBe("2023-11-13"); // never more than three years
  });

  it("totals sales by payment date, keeps refunds apart, and leaves unpaid orders out", async () => {
    const manager = await as("MANAGER");
    const first = await order({ total: 4295 });
    await order({ total: 10000, country: "FR", taxRateBps: 2000, email: "second@example.com" });
    await order({ total: 4295 }); // the same customer again: a returning order
    await order({ paidAt: null, total: 9999 });
    await order({ total: 5000, paidAt: new Date("2020-01-05T00:00:00Z"), email: "long-ago@example.com" }); // outside the period
    await db.refund.create({ data: { paymentId: first.payments[0].id, amountCents: 1000 } });

    const report = await backoffice.salesReport(manager, {});
    expect(report).toMatchObject({ orders: 3, grossCents: 18590, refundedCents: 1000, refundCount: 1, units: 6, firstTimeOrders: 2, returningOrders: 1, averageOrderCents: 6197 });
    expect(report.netCents).toBe(report.grossCents - report.taxCents);
    expect(report.countries).toEqual([{ country: "FR", orders: 1, grossCents: 10000 }, { country: "BE", orders: 2, grossCents: 8590 }]);
    expect(report.products).toEqual([{ sku: "t-500", name: "Test Oil 500 ml", units: 6, grossCents: 10800 }]);
    expect(report.methods).toEqual([{ method: "card", payments: 3, amountCents: 18590 }]);
    expect(report.daily).toHaveLength(1);
    expect((await backoffice.salesReport(manager, { from: "2020-01-01", to: "2020-01-31" })).grossCents).toBe(5000);
    await refused(backoffice.salesReport(await as("STAFF"), {}), "FORBIDDEN");
    expect(await backoffice.exportSalesCsv(manager, {})).toContain("Test Oil 500 ml,t-500,6,108");
  });

  it("reports VAT per destination and rate, and flags orders that had no rate", async () => {
    const manager = await as("MANAGER");
    const be = await order({ total: 10600, taxRateBps: 600 });
    await order({ total: 10600, taxRateBps: 600 });
    await order({ total: 12000, country: "FR", taxRateBps: 2000 });
    await order({ total: 5000, country: "IT", taxRateBps: null });
    await db.refund.create({ data: { paymentId: be.payments[0].id, amountCents: 500 } });

    const report = await backoffice.vatReport(manager, {});
    expect(report.lines).toMatchObject([
      { country: "BE", rateBps: 600, orders: 2, grossCents: 21200, taxCents: 1200, netCents: 20000 },
      { country: "FR", rateBps: 2000, orders: 1, grossCents: 12000, taxCents: 2000, netCents: 10000 },
      { country: "IT", rateBps: null, orders: 1, grossCents: 5000, taxCents: 0, netCents: 5000 },
    ]);
    expect(report).toMatchObject({ grossCents: 38200, taxCents: 3200, netCents: 35000, ordersWithoutRate: 1, refundedCents: 500 });
    expect(report.refunds).toMatchObject([{ amountCents: 500, country: "BE", rateBps: 600 }]);
    const csv = await backoffice.exportVatCsv(manager, {});
    expect(csv).toContain("BE,6,2,200,12,212");
    expect(csv).toContain("IT,no rate set,1,50,0,50");
  });

  it("lists payments with what was received and refunded in the period", async () => {
    const staff = await as("STAFF");
    const paid = await order({ total: 4295 });
    await order({ paidAt: null });
    await db.refund.create({ data: { paymentId: paid.payments[0].id, amountCents: 295 } });
    const result = await backoffice.listPayments(staff, {});
    expect(result).toMatchObject({ count: 1, receivedCents: 4295, receivedCount: 1, refundedCents: 295, refundedCount: 1 });
    expect((await backoffice.listPayments(staff, { status: "FAILED" })).count).toBe(0);
    expect((await backoffice.listPayments(staff, { status: "nonsense" })).count).toBe(1);
  });
});

describe("inventory, reviews and suppliers", () => {
  it("shows availability and who changed stock", async () => {
    const manager = await as("MANAGER");
    const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
    await db.variant.update({ where: { id: variant.id }, data: { reserved: 3 } });
    await admin.adjustStock(manager, variant.id, -2, "DAMAGED", "dropped a case");
    const stock = await backoffice.inventoryOverview(manager);
    expect(stock.rows.find((row) => row.sku === "t-500")).toMatchObject({ stock: 8, reserved: 3, available: 5, low: true });
    expect(stock.rows.find((row) => row.sku === "t-1000")).toMatchObject({ available: 0, low: true });
    expect(stock).toMatchObject({ unitsOnHand: stock.rows.reduce((sum, row) => sum + row.stock, 0), unitsReserved: 3 });
    expect(stock.movements[0]).toMatchObject({ delta: -2, reason: "DAMAGED", by: "MANAGER", note: "dropped a case" });
    expect(await backoffice.exportInventoryCsv(manager)).toContain("Test Oil,500 ml,t-500,8,3,5");
    await refused(backoffice.exportInventoryCsv(await as("STAFF")), "FORBIDDEN");
  });

  it("publishes a review only once a manager approves it", async () => {
    const manager = await as("MANAGER");
    const customer = await db.customer.create({ data: { email: "rev@example.com", passwordHash: "x", firstName: "Rev", lastName: "Iewer" } });
    const product = await db.product.findFirstOrThrow();
    const delivered = await order({ email: "rev@example.com" });
    const review = await db.review.create({ data: { productId: product.id, customerId: customer.id, orderId: delivered.id, rating: 5, title: "Peppery", body: "Lovely on bread." } });

    const shopReviews = async () => (await createClient(server).gql<{ product: { reviews: { title: string }[] } }>(`{ product(slug: "evoo") { reviews { title } } }`)).data?.product.reviews;
    expect(await shopReviews()).toEqual([]);
    expect((await backoffice.listReviews(manager, "PENDING")).counts).toEqual({ PENDING: 1, APPROVED: 0, REJECTED: 0 });
    await refused(backoffice.setReviewStatus(await as("STAFF"), review.id, "APPROVED"), "FORBIDDEN");
    await refused(backoffice.setReviewStatus(manager, review.id, "EDITED"), "BAD_INPUT");

    await backoffice.setReviewStatus(manager, review.id, "APPROVED");
    expect(await shopReviews()).toEqual([{ title: "Peppery" }]);
    await backoffice.setReviewStatus(manager, review.id, "REJECTED");
    expect(await shopReviews()).toEqual([]);
  });

  it("keeps a supplier that has lots, and traces a lot to everyone who received it", async () => {
    const manager = await as("MANAGER");
    const product = await db.product.findFirstOrThrow();
    const mill = await backoffice.saveSupplier(manager, null, { name: "Frantoio Test", kind: "Mill", countryCode: "it", email: "MILL@Example.com", isActive: true });
    const spare = await backoffice.saveSupplier(manager, null, { name: "Unused Boxes", kind: "Packaging", isActive: true });
    await refused(backoffice.saveSupplier(manager, null, { name: "", kind: "Mill" }), "BAD_INPUT");
    await admin.saveBatch(manager, null, { lotNumber: "az-0007", productId: product.id, supplierId: mill, isPublished: false });

    const received = await order({ lot: "AZ-0007", email: "one@example.com" });
    await order({ lot: "AZ-0007", email: "two@example.com", country: "FR" });
    await order({ lot: "AZ-0008", email: "other@example.com" });

    const trace = await backoffice.traceLot(manager, " az-0007 ");
    expect(trace).toMatchObject({ lotNumber: "AZ-0007", orders: 2, units: 4, shippedLinesWithoutLot: 0, batch: { supplier: { name: "Frantoio Test", countryCode: "IT", email: "mill@example.com" } } });
    expect(trace?.lines.map((line) => line.order.email).sort()).toEqual(["one@example.com", "two@example.com"]);
    expect(await backoffice.exportLotTraceCsv(manager, "AZ-0007")).toContain(`${received.number}`);
    expect((await backoffice.traceLot(manager, "NOPE-1"))?.batch).toBeNull();
    expect(await backoffice.traceLot(manager, "  ")).toBeNull();

    expect(await backoffice.removeSupplier(manager, mill)).toBe("deactivated");
    expect(await backoffice.removeSupplier(manager, spare)).toBe("deleted");
    expect((await backoffice.listSuppliers(manager)).map((supplier) => [supplier.name, supplier.isActive])).toEqual([["Frantoio Test", false]]);
  });
});

describe("content and marketing", () => {
  it("saves journal articles, refuses a duplicate address, and dates the first publication", async () => {
    const manager = await as("MANAGER");
    const id = await backoffice.savePost(manager, null, { slug: "first-harvest", title: "First harvest", standfirst: "Early.", body: "One.\n\nTwo.", isPublished: false });
    expect(await backoffice.getPost(manager, id)).toMatchObject({ isPublished: false, publishedAt: null });
    await refused(backoffice.savePost(manager, null, { slug: "first-harvest", title: "Copy" }), /already uses that address/);
    await refused(backoffice.savePost(manager, null, { slug: "Bad Slug", title: "x" }), "BAD_INPUT");
    await backoffice.savePost(manager, id, { slug: "first-harvest", title: "First harvest", isPublished: true });
    const published = await backoffice.getPost(manager, id);
    expect(published.publishedAt).toBeInstanceOf(Date);
    await backoffice.savePost(manager, id, { slug: "first-harvest", title: "First harvest, edited", isPublished: true });
    expect((await backoffice.getPost(manager, id)).publishedAt).toEqual(published.publishedAt);
    await backoffice.deletePost(manager, id);
    expect(await backoffice.listPosts(manager)).toEqual([]);
  });

  it("validates the announcement and lets only administrators set it", async () => {
    await refused(admin.saveSetting(await as("MANAGER"), "content", { announcement: "Hello", announcementOn: true }), "FORBIDDEN");
    const boss = await as("ADMINISTRATOR");
    await refused(admin.saveSetting(boss, "content", { announcement: "x", announcementLink: "javascript:alert(1)", announcementOn: true }), "BAD_INPUT");
    await admin.saveSetting(boss, "content", { announcement: "Order by 18 December", announcementLink: "/shipping-returns", announcementOn: true });
    expect((await admin.getSettings(boss)).content).toEqual({ announcement: "Order by 18 December", announcementLink: "/shipping-returns", announcementOn: true });
  });

  it("measures discount codes by paid orders and lists carts left behind", async () => {
    const staff = await as("STAFF");
    await db.discount.create({ data: { code: "WELCOME", kind: "PERCENT", value: 10, usedCount: 2 } });
    await order({ code: "WELCOME", discount: 360, total: 3935 });
    await order({ code: "WELCOME", discount: 360, total: 3935, paidAt: null });
    const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-750" } });
    await db.cart.create({ data: { tokenHash: "old", updatedAt: new Date(Date.now() - 3 * 86_400_000), items: { create: [{ variantId: variant.id, quantity: 2 }] } } });
    await db.cart.create({ data: { tokenHash: "fresh", items: { create: [{ variantId: variant.id, quantity: 1 }] } } });
    await db.$executeRaw`UPDATE "Cart" SET "updatedAt" = now() - interval '3 days' WHERE "tokenHash" = 'old'`;

    const data = await backoffice.marketingOverview(staff);
    expect(data.discounts).toMatchObject([{ code: "WELCOME", usedCount: 2, paidOrders: 1, revenueCents: 3935, givenCents: 360 }]);
    expect(data.abandoned).toMatchObject([{ email: null, units: 2, valueCents: 5200, summary: "2 × Test Oil 750 ml" }]);
  });
});

describe("wholesale", () => {
  const account = { email: "chef@example.com", password: "a long enough password", firstName: "Chef", lastName: "Test" };
  const REGISTER = `mutation ($input: RegisterInput!) { register(input: $input) { id } }`;
  const CART = `{ cart { subtotalCents discountCents discountCode } }`;

  it("takes an approved account's discount off automatically, and never stacks it with a code", async () => {
    const manager = await as("MANAGER");
    const c = createClient(server);
    await c.gql(`mutation { cartAdd(sku: "t-500", quantity: 2) { itemCount } }`); // a cart started before signing in
    expect((await c.gql(REGISTER, { input: account })).errors).toBeUndefined();
    expect((await c.gql<{ cart: { discountCents: number } }>(CART)).data?.cart.discountCents).toBe(0);

    await refused(backoffice.setWholesaleByEmail(manager, "nobody@example.com", { wholesaleStatus: "APPROVED", companyName: "X", discountPercent: 10 }), /No customer account/);
    await refused(backoffice.setWholesaleByEmail(manager, account.email, { wholesaleStatus: "APPROVED", discountPercent: 15 }), /company name/);
    await refused(backoffice.setWholesaleByEmail(manager, account.email, { wholesaleStatus: "APPROVED", companyName: "Trattoria", discountPercent: 95 }), "BAD_INPUT");
    await refused(backoffice.setWholesaleByEmail(await as("STAFF"), account.email, { wholesaleStatus: "APPROVED", companyName: "Trattoria", discountPercent: 15 }), "FORBIDDEN");
    await backoffice.setWholesaleByEmail(manager, " Chef@Example.com ", { wholesaleStatus: "APPROVED", companyName: "Trattoria Test", companyVatNumber: "BE0123456789", discountPercent: 15 });

    expect((await c.gql(CART)).data).toEqual({ cart: { subtotalCents: 3600, discountCents: 540, discountCode: "WHOLESALE" } });

    // A smaller code changes nothing; a larger one replaces the trade terms rather than adding to them.
    await db.discount.createMany({ data: [{ code: "TEN", kind: "PERCENT", value: 10 }, { code: "THIRTY", kind: "PERCENT", value: 30, usageLimit: 5 }] });
    await c.gql(`mutation { cartApplyDiscount(code: "TEN") { discountCents } }`);
    expect((await c.gql(CART)).data).toMatchObject({ cart: { discountCents: 540, discountCode: "WHOLESALE" } });
    await c.gql(`mutation { cartApplyDiscount(code: "THIRTY") { discountCents } }`);
    expect((await c.gql(CART)).data).toMatchObject({ cart: { discountCents: 1080, discountCode: "THIRTY" } });
    await c.gql(`mutation { cartRemoveDiscount { discountCents } }`);

    const rate = await db.shippingRate.findFirstOrThrow({ orderBy: { priceCents: "asc" } });
    const placed = await c.gql<{ checkout: { number: string } }>(`mutation ($input: CheckoutInput!) { checkout(input: $input) { number } }`, { input: { email: account.email, shippingRateId: rate.id, address: { firstName: "Chef", lastName: "Test", line1: "Keukenstraat 1", postalCode: "1000", city: "Brussels", countryCode: "BE" } } });
    expect(placed.errors).toBeUndefined();
    expect(await db.order.findFirstOrThrow()).toMatchObject({ discountCode: "WHOLESALE", discountCents: 540, subtotalCents: 3600, totalCents: 3600 - 540 + rate.priceCents });

    const accounts = await backoffice.listWholesale(manager);
    expect(accounts).toMatchObject([{ companyName: "Trattoria Test", wholesaleStatus: "APPROVED", wholesaleDiscountBps: 1500 }]);

    // Withdrawing approval removes the discount at once.
    await backoffice.setWholesale(manager, accounts[0].id, { wholesaleStatus: "REJECTED", companyName: "Trattoria Test", discountPercent: 15 });
    await c.gql(`mutation { cartAdd(sku: "t-500", quantity: 1) { itemCount } }`);
    expect((await c.gql(CART)).data).toMatchObject({ cart: { discountCents: 0, discountCode: null } });
  });

  it("gives guests and ordinary accounts no trade discount", async () => {
    const c = createClient(server);
    await c.gql(`mutation { cartAdd(sku: "t-500", quantity: 2) { itemCount } }`);
    expect(code(await c.gql(`mutation { cartApplyDiscount(code: "WHOLESALE") { discountCents } }`))).toBe("DISCOUNT_INVALID");
    expect((await c.gql(CART)).data).toMatchObject({ cart: { discountCents: 0 } });
  });
});

describe("two-factor sign-in", () => {
  it("produces the codes every authenticator app produces (RFC 6238 test vectors)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1111111109_000)).toBe("081804");
    expect(totpCode(secret, 1234567890_000)).toBe("005924");
    expect(verifyTotp(secret, "287 082", 59_000)).toBe(true);
    expect(verifyTotp(secret, "287082", 59_000 + 30_000)).toBe(true); // one step of clock drift
    expect(verifyTotp(secret, "287082", 59_000 + 90_000)).toBe(false);
    expect(verifyTotp(secret, "abcdef", 59_000)).toBe(false);
  });

  it("stores the secret sealed, readable only with the server's key", () => {
    const sealed = sealSecret("GEZDGNBVGY3TQOJQ");
    expect(sealed).not.toContain("GEZDGNBVGY3TQOJQ");
    expect(openSecret(sealed)).toBe("GEZDGNBVGY3TQOJQ");
    expect(() => openSecret(sealed, { APP_SECRET: "a-different-secret-that-is-also-long-enough" })).toThrow();
    expect(() => sealSecret("x", { APP_SECRET: "short" })).toThrow(AppError);
  });

  it("asks for a code at sign-in once enrolled, and not before", async () => {
    const password = "correct horse battery staple";
    const staff = await as("STAFF", password);
    const email = staff.admin!.email;

    const { secret } = await beginTotp(staff);
    expect((await adminLogin(anonymous(), { email, password })).id).toBe(staff.admin!.id); // started but not confirmed: still password only
    await refused(confirmTotp({ ...staff, admin: await db.adminUser.findUniqueOrThrow({ where: { id: staff.admin!.id } }) }, "000000"), /not right/);
    await confirmTotp({ ...staff, admin: await db.adminUser.findUniqueOrThrow({ where: { id: staff.admin!.id } }) }, totpCode(secret, Date.now()));

    await refused(adminLogin(anonymous(), { email, password }), /6-digit code/);
    await refused(adminLogin(anonymous(), { email, password, code: "123456" }), /not right/);
    await refused(adminLogin(anonymous(), { email, password: "wrong password", code: totpCode(secret, Date.now()) }), /email address or password/);
    const signedIn = anonymous();
    expect((await adminLogin(signedIn, { email, password, code: totpCode(secret, Date.now()) })).id).toBe(staff.admin!.id);
    expect(signedIn.setCookies.join()).toContain("azz_admin=");
    expect(await db.auditLog.count({ where: { action: "admin.login.failed" } })).toBe(2); // the wrong code and the wrong password; a missing code is a prompt, not a failure

    const enrolled = { ...staff, admin: await db.adminUser.findUniqueOrThrow({ where: { id: staff.admin!.id } }) };
    await refused(beginTotp(enrolled), /already on/);
    await refused(disableTotp(enrolled, "wrong"), /password is not right/);
    await disableTotp(enrolled, password);
    await db.rateLimit.deleteMany(); // this test signs in more often than the five tries an address gets in 15 minutes
    expect((await adminLogin(anonymous(), { email, password })).id).toBe(staff.admin!.id);
  });

  it("lets an administrator reset someone's second factor and end sessions, and staff only their own", async () => {
    const password = "correct horse battery staple";
    const staff = await as("STAFF", password);
    const other = await as("STAFF", password);
    const boss = await as("ADMINISTRATOR");
    const { secret } = await beginTotp(staff);
    await confirmTotp({ ...staff, admin: await db.adminUser.findUniqueOrThrow({ where: { id: staff.admin!.id } }) }, totpCode(secret, Date.now()));
    await adminLogin(anonymous(), { email: staff.admin!.email, password, code: totpCode(secret, Date.now()) });
    await adminLogin(anonymous(), { email: other.admin!.email, password });

    const mine = await securityOverview(other);
    expect(mine).toMatchObject({ everyone: false, staff: [], me: { totpOn: false, pending: null } });
    expect(mine.sessions.map((session) => session.email)).toEqual([other.admin!.email]);
    const all = await securityOverview(boss);
    expect(all.sessions).toHaveLength(2);
    expect(all.staff.filter((user) => user.totpEnabledAt)).toHaveLength(1);

    const staffSession = all.sessions.find((session) => session.email === staff.admin!.email)!;
    await refused(revokeSession(other, staffSession.id), "NOT_FOUND");
    await refused(resetTotpFor(other, staff.admin!.id), "FORBIDDEN");
    await resetTotpFor(boss, staff.admin!.id);
    expect(await db.adminSession.count({ where: { adminUserId: staff.admin!.id } })).toBe(0);
    expect((await adminLogin(anonymous(), { email: staff.admin!.email, password })).id).toBe(staff.admin!.id);
    await revokeSession(other, mine.sessions[0].id);
    expect(await db.adminSession.count({ where: { adminUserId: other.admin!.id } })).toBe(0);
  });
});

describe("photos and integrations", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

  it("accepts only real images, by their content rather than their name", async () => {
    const manager = await as("MANAGER");
    const product = await db.product.findFirstOrThrow();
    expect(backoffice.sniffImage(PNG)).toBe("image/png");
    expect(backoffice.sniffImage(JPEG)).toBe("image/jpeg");
    expect(backoffice.sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();

    await refused(backoffice.addProductPhoto(manager, product.id, { data: new TextEncoder().encode("<script>alert(1)</script>"), alt: "x" }), /JPEG, PNG or WebP/);
    await refused(backoffice.addProductPhoto(manager, product.id, { data: new Uint8Array(), alt: "x" }), /Choose a photo/);
    await refused(backoffice.addProductPhoto(manager, product.id, { data: PNG, alt: "  " }), /Describe the photo/);
    const big = new Uint8Array(backoffice.PHOTO_MAX_BYTES + 1);
    big.set(JPEG);
    await refused(backoffice.addProductPhoto(manager, product.id, { data: big, alt: "x" }), /larger than 4 MB/);
    await refused(backoffice.addProductPhoto(await as("STAFF"), product.id, { data: PNG, alt: "Bottle" }), "FORBIDDEN");

    const id = await backoffice.addProductPhoto(manager, product.id, { data: PNG, alt: "The 500 ml bottle on a table" });
    expect(await backoffice.listProductPhotos(manager, product.id)).toMatchObject([{ id, url: `/media/${id}`, alt: "The 500 ml bottle on a table", mime: "image/png", bytes: 12, position: 0 }]);
    await backoffice.removeProductPhoto(manager, id);
    expect(await backoffice.listProductPhotos(manager, product.id)).toEqual([]);
  });

  it("reports what is configured without revealing a single credential", async () => {
    const staff = await as("STAFF");
    const none = integrationStatus(staff, {});
    expect(none.every((integration) => !integration.connected)).toBe(true);
    expect(none.find((integration) => integration.name === "Stripe")?.missing).toEqual(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);

    const env = { STRIPE_SECRET_KEY: "sk_test_abcdefSECRETVALUE", STRIPE_WEBHOOK_SECRET: "whsec_SECRETVALUE", RESEND_API_KEY: "re_SECRETVALUE", EMAIL_FROM: "Shop <onboarding@resend.dev>", APP_SECRET: SECRET };
    const some = integrationStatus(staff, env);
    expect(some.find((integration) => integration.name === "Stripe")).toMatchObject({ connected: true, detail: "Test mode: no real money is taken." });
    expect(some.find((integration) => integration.name === "Resend")?.detail).toMatch(/test sender/);
    expect(some.find((integration) => integration.name.startsWith("Link signing"))?.connected).toBe(true);
    expect(JSON.stringify(some)).not.toContain("SECRETVALUE");
    expect(() => integrationStatus(anonymous(), {})).toThrow(AppError);
  });
});
