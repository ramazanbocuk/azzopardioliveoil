import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AdminRole } from "@/generated/prisma/client";
import * as admin from "@/server/admin";
import type { Ctx } from "@/server/context";
import { hashPassword } from "@/server/crypto";
import { AppError } from "@/server/errors";
import { setPaymentProvider, type PaymentProvider } from "@/server/payments";
import { db, resetDb, seedCatalog } from "../helpers";

const ADDRESS = { shipFirstName: "Test", shipLastName: "Customer", shipLine1: "Teststraat 1", shipPostalCode: "1000", shipCity: "Brussels", shipCountryCode: "BE" };

async function as(role: AdminRole | null): Promise<Ctx> {
  const user = role ? await db.adminUser.create({ data: { email: `${role}-${Math.random().toString(36).slice(2)}@test.local`, name: role, role, passwordHash: "x" } }) : null;
  return { db, ip: "10.9.9.9", userAgent: null, cookies: {}, setCookies: [], customer: null, admin: user };
}

/** Asserts the call is refused with the given code. */
async function refused(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function makeOrder(status: "PENDING_PAYMENT" | "PAID", quantity = 2) {
  const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
  const paid = status === "PAID";
  if (!paid) await db.variant.update({ where: { id: variant.id }, data: { reserved: { increment: quantity } } });
  const order = await db.order.create({
    data: {
      ...ADDRESS,
      email: "buyer@example.com",
      status,
      paymentStatus: paid ? "PAID" : "UNPAID",
      paidAt: paid ? new Date() : null,
      subtotalCents: 1800 * quantity,
      shippingCents: 695,
      totalCents: 1800 * quantity + 695,
      shippingRateName: "Standard",
      weightGrams: 950 * quantity,
      number: `AZZ-${Math.floor(Math.random() * 90000) + 10000}`,
      items: { create: [{ variantId: variant.id, sku: "t-500", productName: "Test Oil", variantLabel: "500 ml", unitPriceCents: 1800, quantity, lineTotalCents: 1800 * quantity }] },
      payments: paid ? { create: [{ provider: "STRIPE", providerRef: `cs_${Math.random().toString(36).slice(2)}`, status: "PAID", amountCents: 1800 * quantity + 695 }] } : undefined,
    },
  });
  return order.id;
}

const refunds: { amountCents: number }[] = [];
const fakeProvider: PaymentProvider = {
  name: "STRIPE",
  createCheckout: async () => ({ providerRef: "cs", url: "https://pay.example" }),
  parseWebhook: () => {
    throw new Error("unused");
  },
  refund: async ({ amountCents }) => {
    refunds.push({ amountCents });
    return `re_${refunds.length}`;
  },
};

beforeEach(async () => {
  await resetDb();
  await seedCatalog();
  refunds.length = 0;
  setPaymentProvider(fakeProvider);
});

afterAll(() => setPaymentProvider(undefined));

describe("roles", () => {
  it("shuts out anyone without an admin session", async () => {
    const nobody = await as(null);
    await refused(admin.dashboard(nobody), "UNAUTHENTICATED");
    await refused(admin.listOrders(nobody, {}), "UNAUTHENTICATED");
    await refused(admin.exportCustomersCsv(nobody), "UNAUTHENTICATED");
  });

  it("lets staff work on orders but not change the catalogue, money or people", async () => {
    const staff = await as("STAFF");
    const orderId = await makeOrder("PAID");
    const product = await db.product.findUniqueOrThrow({ where: { slug: "evoo" } });
    const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });

    await admin.addOrderNote(staff, orderId, "Packed carefully.");
    await admin.startFulfilment(staff, orderId);

    await refused(admin.saveProduct(staff, product.id, { name: "X", slug: "x", categoryId: product.categoryId }), "FORBIDDEN");
    await refused(admin.adjustStock(staff, variant.id, 5, "RECEIVED"), "FORBIDDEN");
    await refused(admin.saveDiscount(staff, null, { code: "FREE", kind: "PERCENT", value: 100 }), "FORBIDDEN");
    await refused(admin.exportCustomersCsv(staff), "FORBIDDEN");
    await refused(admin.refundOrder(staff, orderId, { amountCents: 100 }), "FORBIDDEN");
    await refused(admin.saveTaxRate(staff, { countryCode: "BE", ratePercent: 6 }), "FORBIDDEN");
    await refused(admin.createStaff(staff, { email: "x@y.co", name: "X", role: "ADMINISTRATOR", password: "a long enough password" }), "FORBIDDEN");
  });

  it("keeps refunds, VAT, settings, staff and erasure for administrators", async () => {
    const manager = await as("MANAGER");
    const orderId = await makeOrder("PAID");
    const customer = await db.customer.create({ data: { email: "c@example.com", passwordHash: "x", firstName: "C", lastName: "D" } });
    await refused(admin.refundOrder(manager, orderId, { amountCents: 100 }), "FORBIDDEN");
    await refused(admin.saveTaxRate(manager, { countryCode: "BE", ratePercent: 6 }), "FORBIDDEN");
    await refused(admin.saveSetting(manager, "store", { legalName: "X" }), "FORBIDDEN");
    await refused(admin.eraseCustomer(manager, customer.id), "FORBIDDEN");
    await refused(admin.updateStaff(manager, "any", { isActive: false }), "FORBIDDEN");
    expect(refunds).toHaveLength(0);
  });
});

describe("catalogue", () => {
  it("creates products and sizes, refusing duplicate addresses and SKUs", async () => {
    const manager = await as("MANAGER");
    const category = await db.category.findFirstOrThrow();
    const created = await admin.saveProduct(manager, null, { name: "Gift Tin", slug: "gift-tin", categoryId: category.id, isVisible: true });
    await refused(admin.saveProduct(manager, null, { name: "Other", slug: "gift-tin", categoryId: category.id }), "BAD_INPUT");
    await refused(admin.saveProduct(manager, null, { name: "Bad", slug: "Not A Slug", categoryId: category.id }), "BAD_INPUT");

    const variant = await admin.saveVariant(manager, created.id, null, { sku: "tin-3000", label: "3 L", volumeMl: 3000, priceCents: 8900, weightGrams: 3400 });
    expect(variant).toMatchObject({ priceCents: 8900, stock: 0, isActive: true });
    await refused(admin.saveVariant(manager, created.id, null, { sku: "t-500", label: "dup", volumeMl: 1, priceCents: 1, weightGrams: 1 }), "BAD_INPUT");
    expect((await db.auditLog.findMany({ where: { actorId: manager.admin?.id } })).map((row) => row.action)).toEqual(["product.create", "variant.create"]);
  });

  it("adjusts stock with a ledger entry, never below what unpaid orders hold", async () => {
    const manager = await as("MANAGER");
    await makeOrder("PENDING_PAYMENT", 4);
    const variant = await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } });
    await refused(admin.adjustStock(manager, variant.id, -7, "DAMAGED"), "BAD_INPUT");
    await refused(admin.adjustStock(manager, variant.id, 0, "ADJUSTMENT"), "BAD_INPUT");
    await admin.adjustStock(manager, variant.id, -6, "DAMAGED", "dropped a case");
    expect((await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(4);
    expect(await db.inventoryMovement.findFirstOrThrow()).toMatchObject({ delta: -6, reason: "DAMAGED", note: "dropped a case" });
  });

  it("soft-deletes products so order history survives", async () => {
    const manager = await as("MANAGER");
    const product = await db.product.findUniqueOrThrow({ where: { slug: "evoo" } });
    const orderId = await makeOrder("PAID");
    await admin.deleteProduct(manager, product.id);
    expect(await admin.listProducts(manager)).toHaveLength(1); // only the other seeded product remains
    expect((await admin.getOrder(manager, orderId)).items[0].productName).toBe("Test Oil");
  });

  it("validates lots and only accepts existing lots on order lines", async () => {
    const manager = await as("MANAGER");
    const product = await db.product.findUniqueOrThrow({ where: { slug: "evoo" } });
    const orderId = await makeOrder("PAID");
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
    await refused(admin.saveBatch(manager, null, { lotNumber: "no", productId: product.id }), "BAD_INPUT");
    await refused(admin.setItemLot(manager, item.id, "AZ-0404"), "BAD_INPUT");
    const batch = await admin.saveBatch(manager, null, { lotNumber: "az-0001", productId: product.id, harvestDate: "2026-10-20", grove: "", isPublished: true });
    expect(batch).toMatchObject({ lotNumber: "AZ-0001", grove: null, isPublished: true });
    expect(batch.harvestDate?.toISOString().slice(0, 10)).toBe("2026-10-20");
    await admin.setItemLot(manager, item.id, "az-0001");
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: item.id } })).lotNumber).toBe("AZ-0001");
  });
});

describe("orders", () => {
  it("moves a paid order through packing, shipping and delivery, in that order only", async () => {
    const staff = await as("STAFF");
    const orderId = await makeOrder("PAID");
    await refused(admin.markDelivered(staff, orderId), "BAD_INPUT");
    await admin.startFulfilment(staff, orderId);
    await refused(admin.markShipped(staff, orderId, { carrier: "" }), "BAD_INPUT");
    await admin.markShipped(staff, orderId, { carrier: "bpost", trackingNumber: "3232", trackingUrl: "https://track.example/3232" });
    await refused(admin.markShipped(staff, orderId, { carrier: "bpost" }), "BAD_INPUT");
    await admin.markDelivered(staff, orderId);

    const order = await admin.getOrder(staff, orderId);
    expect(order.status).toBe("DELIVERED");
    expect(order.shipments[0]).toMatchObject({ carrier: "bpost", trackingNumber: "3232", status: "DELIVERED" });
    expect(order.events.map((e) => e.kind)).toEqual(["fulfilling", "shipped", "delivered"]);
    expect(await db.outboxJob.findFirstOrThrow()).toMatchObject({ kind: "notify.customer.shipped" });
  });

  it("will not ship an order that has not been paid", async () => {
    const staff = await as("STAFF");
    const orderId = await makeOrder("PENDING_PAYMENT");
    await refused(admin.startFulfilment(staff, orderId), "BAD_INPUT");
    await refused(admin.markShipped(staff, orderId, { carrier: "bpost" }), "BAD_INPUT");
  });

  it("cancels unpaid orders and frees their stock, but refuses to cancel paid ones", async () => {
    const manager = await as("MANAGER");
    const unpaid = await makeOrder("PENDING_PAYMENT", 3);
    const paid = await makeOrder("PAID");
    expect((await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } })).reserved).toBe(3);
    await admin.cancelUnpaidOrder(manager, unpaid);
    expect((await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } })).reserved).toBe(0);
    await refused(admin.cancelUnpaidOrder(manager, paid), "BAD_INPUT");
    await refused(admin.cancelUnpaidOrder(manager, unpaid), "BAD_INPUT");
  });

  it("refunds through the provider first, in parts or in full, and can restock", async () => {
    const boss = await as("ADMINISTRATOR");
    const orderId = await makeOrder("PAID", 2); // 42.95 total
    await refused(admin.refundOrder(boss, orderId, { amountCents: 5000 }), "BAD_INPUT");

    await admin.refundOrder(boss, orderId, { amountCents: 1000, reason: "Dented cap" });
    expect((await admin.getOrder(boss, orderId)).paymentStatus).toBe("PARTIALLY_REFUNDED");
    await refused(admin.refundOrder(boss, orderId, { amountCents: 3296 }), "BAD_INPUT");

    await admin.refundOrder(boss, orderId, { amountCents: 3295, restock: true });
    const order = await admin.getOrder(boss, orderId);
    expect([order.status, order.paymentStatus]).toEqual(["REFUNDED", "REFUNDED"]);
    expect(refunds).toEqual([{ amountCents: 1000 }, { amountCents: 3295 }]);
    expect((await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } })).stock).toBe(12);
  });

  it("records no refund when no provider is connected or the provider fails", async () => {
    const boss = await as("ADMINISTRATOR");
    const orderId = await makeOrder("PAID");
    setPaymentProvider(null);
    await refused(admin.refundOrder(boss, orderId, { amountCents: 500 }), "PAYMENT_UNAVAILABLE");
    setPaymentProvider({ ...fakeProvider, refund: async () => Promise.reject(new Error("card network down")) });
    await expect(admin.refundOrder(boss, orderId, { amountCents: 500 })).rejects.toThrow("card network down");
    expect(await db.refund.count()).toBe(0);
    expect((await admin.getOrder(boss, orderId)).paymentStatus).toBe("PAID");
  });

  it("finds orders by number, email or surname, and by status", async () => {
    const staff = await as("STAFF");
    await makeOrder("PAID");
    await makeOrder("PENDING_PAYMENT");
    expect((await admin.listOrders(staff, {})).count).toBe(2);
    expect((await admin.listOrders(staff, { status: "PAID" })).count).toBe(1);
    expect((await admin.listOrders(staff, { q: "BUYER@" })).count).toBe(2);
    expect((await admin.listOrders(staff, { q: "customer" })).count).toBe(2);
    expect((await admin.listOrders(staff, { q: "nobody" })).count).toBe(0);
  });
});

describe("customers and exports", () => {
  it("erases personal data but keeps the orders the law requires", async () => {
    const boss = await as("ADMINISTRATOR");
    const customer = await db.customer.create({ data: { email: "ada@example.com", passwordHash: await hashPassword("a long enough password"), firstName: "Ada", lastName: "Lovelace", phone: "+3247000000", addresses: { create: [{ ...{ firstName: "Ada", lastName: "L", line1: "S 1", postalCode: "1000", city: "B", countryCode: "BE" } }] } } });
    const orderId = await makeOrder("PAID");
    await db.order.update({ where: { id: orderId }, data: { customerId: customer.id } });

    await admin.eraseCustomer(boss, customer.id);
    const erased = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(erased).toMatchObject({ firstName: "Erased", phone: null, passwordHash: "erased" });
    expect(erased.email).not.toContain("ada");
    expect(await db.address.count()).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).customerId).toBeNull();
    expect(await admin.listCustomers(boss)).toHaveLength(0);
  });

  it("writes CSV that cannot run as spreadsheet formulas", () => {
    const csv = admin.toCsv([["Name", "Note"], ["=HYPERLINK(\"http://evil\")", 'He said "hi", twice'], ["+32 470", null], ["-1", 5]]);
    expect(csv).toBe(`Name,Note\r\n"'=HYPERLINK(""http://evil"")","He said ""hi"", twice"\r\n'+32 470,\r\n'-1,5\r\n`);
  });

  it("logs every export", async () => {
    const manager = await as("MANAGER");
    await makeOrder("PAID");
    expect(await admin.exportOrdersCsv(manager)).toContain("buyer@example.com");
    await admin.exportNewsletterCsv(manager);
    expect((await db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((row) => row.action)).toEqual(["order.export", "newsletter.export"]);
  });
});

describe("settings and staff", () => {
  it("stores VAT as basis points and validates discounts", async () => {
    const boss = await as("ADMINISTRATOR");
    await admin.saveTaxRate(boss, { countryCode: "be", ratePercent: "6" });
    await admin.saveTaxRate(boss, { countryCode: "BE", ratePercent: 5.5 });
    expect(await db.taxRate.findMany()).toMatchObject([{ countryCode: "BE", rateBps: 550 }]);
    await refused(admin.saveDiscount(boss, null, { code: "HUGE", kind: "PERCENT", value: 150 }), "BAD_INPUT");
    await admin.saveDiscount(boss, null, { code: "ten", kind: "PERCENT", value: 10, usageLimit: "" });
    expect(await db.discount.findFirstOrThrow()).toMatchObject({ code: "TEN", usageLimit: null });
  });

  it("creates staff with hashed passwords and never leaves the shop without an administrator", async () => {
    const boss = await as("ADMINISTRATOR");
    await admin.createStaff(boss, { email: "New@Shop.be", name: "New", role: "STAFF", password: "a long enough password" });
    const created = await db.adminUser.findUniqueOrThrow({ where: { email: "new@shop.be" } });
    expect(created.passwordHash).toMatch(/^\$argon2id\$/);
    await refused(admin.createStaff(boss, { email: "new@shop.be", name: "Dup", role: "STAFF", password: "a long enough password" }), "EMAIL_TAKEN");
    await refused(admin.createStaff(boss, { email: "weak@shop.be", name: "Weak", role: "STAFF", password: "short" }), "BAD_INPUT");

    await refused(admin.updateStaff(boss, boss.admin!.id, { isActive: false }), "BAD_INPUT"); // not yourself
    await admin.updateStaff(boss, created.id, { role: "ADMINISTRATOR" });
    const second = { ...boss, admin: await db.adminUser.findUniqueOrThrow({ where: { id: created.id } }) };
    await admin.updateStaff(second, boss.admin!.id, { isActive: false });
    await refused(admin.updateStaff(second, second.admin.id, { role: "STAFF" }), "BAD_INPUT"); // the last administrator stays
  });

  it("summarises the business for the dashboard", async () => {
    const staff = await as("STAFF");
    await makeOrder("PAID", 2);
    await makeOrder("PAID", 1);
    await makeOrder("PENDING_PAYMENT", 1);
    const stats = await admin.dashboard(staff);
    expect(stats).toMatchObject({ revenueCents: 4295 + 2495, paidOrders: 2, averageOrderCents: 3395, ordersToday: 3, awaitingFulfilment: 2 });
    expect(stats.bestSellers[0]).toMatchObject({ sku: "t-500", units: 3 });
    expect(stats.daily).toHaveLength(1);
    expect(stats.lowStock.map((row) => row.sku)).toContain("t-1000");
  });
});
