/**
 * Development seed. Idempotent: safe to run again.
 *
 * It creates the catalogue SHAPE with placeholder prices and stock so the
 * shop can be exercised. It deliberately creates:
 *   - no lots, analyses, certifications or awards
 *   - no VAT rates (to be entered after confirmation with an accountant)
 *   - no product facts (origin, ingredients, nutrition): left null
 * Shipping rates are marked "placeholder" and must be replaced with real
 * carrier rates in the admin panel.
 */
import "dotenv/config";
import { hashPassword } from "../src/server/crypto";
import { getPrisma } from "../src/server/db";

async function main() {
  const db = getPrisma();

  const category = await db.category.upsert({
    where: { slug: "extra-virgin-olive-oil" },
    update: {},
    create: { slug: "extra-virgin-olive-oil", name: "Extra Virgin Olive Oil", intro: "Our oil, bottled by the lot in three sizes." },
  });

  const product = await db.product.upsert({
    where: { slug: "extra-virgin-olive-oil" },
    update: {},
    create: {
      slug: "extra-virgin-olive-oil",
      name: "Extra Virgin Olive Oil",
      blurb: "One oil, bottled by the lot. Choose the size that suits your table.",
      description: "Placeholder description. Tasting notes are written per lot once it has been tasted.",
      categoryId: category.id,
      isVisible: true,
      isFeatured: true,
    },
  });

  // Placeholder prices, weights and stock.
  const variants = [
    { sku: "evoo-500", label: "500 ml", volumeMl: 500, priceCents: 1800, weightGrams: 950, position: 0 },
    { sku: "evoo-750", label: "750 ml", volumeMl: 750, priceCents: 2600, weightGrams: 1350, position: 1 },
    { sku: "evoo-1000", label: "1000 ml", volumeMl: 1000, priceCents: 3200, weightGrams: 1750, position: 2 },
  ];
  for (const variant of variants) {
    await db.variant.upsert({ where: { sku: variant.sku }, update: {}, create: { ...variant, productId: product.id, stock: 48 } });
  }

  if ((await db.shippingZone.count()) === 0) {
    await db.shippingZone.create({
      data: {
        name: "Benelux, France, Germany, Italy (placeholder)",
        countries: ["BE", "LU", "NL", "FR", "DE", "IT"],
        rates: {
          create: [
            { name: "Standard (placeholder rate)", priceCents: 695, freeAboveCents: 7500, estimate: "To be confirmed", position: 0 },
            { name: "Express (placeholder rate)", priceCents: 1495, estimate: "To be confirmed", position: 1 },
          ],
        },
      },
    });
  }

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if ((await db.adminUser.count()) > 0) {
    console.log("Admin user already exists; not creating another.");
  } else if (email && password && password.length >= 12) {
    await db.adminUser.create({ data: { email, name: "Administrator", role: "ADMINISTRATOR", passwordHash: await hashPassword(password) } });
    console.log(`Created administrator ${email}.`);
  } else {
    console.log("No administrator created: set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters) in .env and run the seed again.");
  }

  console.log("Seed complete.");
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
