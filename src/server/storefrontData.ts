import { cacheLife, cacheTag } from "next/cache";
import { bottleScale, type CatalogItem, type Category, type Product } from "@/content/site";
import { getPrisma } from "./db";

/**
 * Catalogue data for server-rendered pages, read straight from the database
 * (no HTTP hop) and cached. Admin changes call `revalidateTag("catalog")`;
 * otherwise entries refresh within minutes, which bounds how stale an
 * "in stock" badge can be. The cart and checkout always re-check live stock.
 */

const day = (date: Date | null) => (date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date) : null);

export async function getCatalogData(): Promise<{ categories: Category[]; products: Product[]; items: CatalogItem[] }> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");

  const db = getPrisma();
  const [categoryRows, productRows] = await Promise.all([
    db.category.findMany({ where: { isVisible: true }, orderBy: { position: "asc" } }),
    db.product.findMany({
      where: { isVisible: true, deletedAt: null, category: { isVisible: true } },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      include: {
        category: true,
        variants: { where: { isActive: true }, orderBy: { position: "asc" } },
        batches: { where: { isPublished: true }, orderBy: { bottledAt: "desc" }, take: 1 },
      },
    }),
  ]);

  const categories: Category[] = categoryRows.map((c) => ({ slug: c.slug, name: c.name, intro: c.intro }));
  const products: Product[] = productRows.map((p) => {
    const lot = p.batches[0] ?? null;
    return {
      slug: p.slug,
      name: p.name,
      categorySlug: p.category.slug,
      blurb: p.blurb,
      description: p.description.split(/\n{2,}/).filter(Boolean),
      lot: lot?.lotNumber ?? null,
      variants: p.variants.map((v) => ({ sku: v.sku, ml: v.volumeMl, label: v.label, priceCents: v.priceCents, scale: bottleScale(v.volumeMl), inStock: v.stock - v.reserved > 0 })),
      facts: {
        origin: p.origin,
        cultivar: p.cultivar,
        ingredients: p.ingredients,
        storage: p.storage,
        nutrition: Array.isArray(p.nutrition) ? (p.nutrition as { label: string; value: string | null }[]) : [],
        harvest: day(lot?.harvestDate ?? null),
        mill: lot?.mill ?? null,
        bottled: day(lot?.bottledAt ?? null),
        bestBefore: day(lot?.bestBefore ?? null),
      },
    };
  });

  const items = products.flatMap((product) => {
    const category = categories.find((c) => c.slug === product.categorySlug);
    return category ? product.variants.map((variant) => ({ product, variant, category })) : [];
  });

  return { categories, products, items };
}

/** Lowest free-shipping threshold among active rates, for "free from €X" messaging. Null if none. */
export async function getFreeShippingThreshold(): Promise<number | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("shipping");
  const rate = await getPrisma().shippingRate.findFirst({ where: { isActive: true, freeAboveCents: { not: null }, zone: { isActive: true } }, orderBy: { freeAboveCents: "asc" } });
  return rate?.freeAboveCents ?? null;
}
