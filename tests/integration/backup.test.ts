import { beforeEach, describe, expect, it } from "vitest";
import { createBackup, restoreBackup } from "../../scripts/backup";
import { db, resetDb, seedCatalog, BILL } from "../helpers";
import { TEST_DATABASE_URL } from "../testDb";

async function fill() {
  await seedCatalog();
  const product = await db.product.findUniqueOrThrow({ where: { slug: "evoo" } });
  const customer = await db.customer.create({ data: { email: "ada@example.com", passwordHash: "hash", firstName: "Ada", lastName: "O’Brien “quoted”" } });
  await db.batch.create({ data: { lotNumber: "AZ-0001", productId: product.id, harvestDate: new Date("2026-10-20T00:00:00Z"), isPublished: true } });
  await db.setting.create({ data: { key: "store", value: { legalName: "Test BV", nested: { list: [1, 2, 3] } } } });
  for (let i = 0; i < 3; i++) {
    await db.order.create({
      data: { customerId: customer.id, email: customer.email, subtotalCents: 1800, shippingCents: 695, totalCents: 2495, taxCents: null, shippingRateName: "Standard", weightGrams: 950, shipFirstName: "Ada", shipLastName: "L", shipLine1: "S 1", shipPostalCode: "1000", shipCity: "B", shipCountryCode: "BE", ...BILL, items: { create: [{ sku: "t-500", productName: "Test Oil", variantLabel: "500 ml", unitPriceCents: 1800, quantity: 1, lineTotalCents: 1800 }] } },
    });
  }
}

const snapshot = async () => ({
  counts: [await db.product.count(), await db.variant.count(), await db.customer.count(), await db.order.count(), await db.orderItem.count(), await db.shippingRate.count()],
  customer: await db.customer.findFirst(),
  lot: await db.batch.findFirst(),
  zone: await db.shippingZone.findFirst(),
  setting: await db.setting.findFirst(),
  orders: await db.order.findMany({ orderBy: { sequence: "asc" }, include: { items: true } }),
});

beforeEach(resetDb);

describe("backup and restore", () => {
  it("restores every row exactly, including dates, arrays, JSON and awkward text", async () => {
    await fill();
    const before = await snapshot();
    const backup = JSON.parse(JSON.stringify(await createBackup(TEST_DATABASE_URL))); // as read back from a file

    await resetDb();
    expect(await db.order.count()).toBe(0);
    await restoreBackup(TEST_DATABASE_URL, backup);

    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after.lot?.harvestDate?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(after.zone?.countries).toEqual(["BE", "FR"]);
  });

  it("continues order numbering after the restored orders", async () => {
    await fill();
    const backup = await createBackup(TEST_DATABASE_URL);
    await resetDb();
    await restoreBackup(TEST_DATABASE_URL, backup);
    const highest = (await db.order.aggregate({ _max: { sequence: true } }))._max.sequence ?? 0;
    const next = await db.order.create({ data: { email: "n@example.com", subtotalCents: 1, shippingCents: 0, totalCents: 1, shippingRateName: "S", weightGrams: 1, shipFirstName: "A", shipLastName: "B", shipLine1: "S", shipPostalCode: "1", shipCity: "B", shipCountryCode: "BE", ...BILL } });
    expect(next.sequence).toBe(highest + 1);
  });

  it("refuses to restore over existing data unless forced, and changes nothing when it refuses", async () => {
    await fill();
    const backup = await createBackup(TEST_DATABASE_URL);
    await db.customer.create({ data: { email: "later@example.com", passwordHash: "h", firstName: "L", lastName: "L" } });

    await expect(restoreBackup(TEST_DATABASE_URL, backup)).rejects.toThrow(/not empty/);
    expect(await db.customer.count()).toBe(2);

    await restoreBackup(TEST_DATABASE_URL, backup, { force: true });
    expect(await db.customer.count()).toBe(1); // back to the moment of the backup
  });

  it("refuses a backup taken on a different schema version", async () => {
    await fill();
    const backup = await createBackup(TEST_DATABASE_URL);
    await resetDb();
    await expect(restoreBackup(TEST_DATABASE_URL, { ...backup, migrations: [...backup.migrations, "29990101000000_future"] })).rejects.toThrow(/does not match/);
    expect(await db.product.count()).toBe(0);
  });
});
