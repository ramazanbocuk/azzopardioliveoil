import { allPrices } from "@/i18n/currency";
import { bottleScale, type CatalogItem, type Category, type Product } from "@/content/site";
import { tagOf, toLocale } from "@/i18n/config";
import type { Db } from "./db";
import { publicLabResults } from "./provenance";
import { publishedLanguages, publishedTranslations } from "./translations";

/**
 * The catalogue as customers may see it, read straight from the database.
 * Pages reach it through a short cache (storefrontData.ts); the assistant
 * calls it directly, because "is it in stock?" must be answered from now,
 * not from a few minutes ago.
 */

/**
 * `language` selects published translations of names and descriptions. A
 * record without one keeps its English text, and says so (`translated`), so
 * the page never presents English as if it were a translation.
 */
export async function loadCatalog(db: Db, language = "en"): Promise<{ categories: Category[]; products: Product[]; items: CatalogItem[] }> {
  const tag = tagOf(toLocale(language));
  const day = (date: Date | null) => (date ? new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date) : null);
  const [categoryRows, productRows, productText, categoryText, productLanguages, categoryLanguages] = await Promise.all([
    db.category.findMany({ where: { isVisible: true }, orderBy: { position: "asc" } }),
    db.product.findMany({
      where: { isVisible: true, deletedAt: null, category: { isVisible: true } },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      include: {
        category: true,
        region: true,
        varieties: { include: { variety: { select: { name: true } } }, orderBy: [{ percent: "desc" }, { varietyId: "asc" }] },
        variants: { where: { isActive: true }, orderBy: { position: "asc" }, include: { prices: true } },
        batches: { where: { isPublished: true }, orderBy: { bottledAt: "desc" }, take: 1 },
      },
    }),
    publishedTranslations(db, "product", language),
    publishedTranslations(db, "category", language),
    publishedLanguages(db, "product"),
    publishedLanguages(db, "category"),
  ]);

  // Laboratory values of each product's current lot: verified ones only, and only for published lots.
  const lab = await publicLabResults(db, productRows.flatMap((p) => (p.batches[0] ? [p.batches[0].id] : [])));

  const categories: Category[] = categoryRows.map((c) => {
    const text = categoryText.get(c.id);
    return { slug: c.slug, name: text?.name ?? c.name, intro: text?.intro ?? c.intro, languages: categoryLanguages.get(c.id) ?? ["en"] };
  });

  const products: Product[] = productRows.map((p) => {
    const lot = p.batches[0] ?? null;
    const text = productText.get(p.id);
    return {
      excludedCountries: p.excludedCountries,
      slug: p.slug,
      name: text?.name ?? p.name,
      categorySlug: p.category.slug,
      blurb: text?.blurb ?? p.blurb,
      description: (text?.description ?? p.description).split(/\n{2,}/).filter(Boolean),
      backorderNote: p.allowBackorder ? (text?.backorderNote ?? p.backorderNote) : null,
      languages: productLanguages.get(p.id) ?? ["en"],
      translated: language === "en" || !!text,
      lot: lot?.lotNumber ?? null,
      profile: {
        country: p.originCountry,
        region: p.region?.name ?? null,
        varieties: p.varieties.map((entry) => ({ name: entry.variety.name, percent: entry.percent })),
        composition: p.composition,
        harvestYear: lot?.harvestYear ?? null,
        harvesting: text?.harvestMethod ?? p.harvestMethod,
        extraction: text?.extractionMethod ?? p.extractionMethod,
        aroma: text?.aroma ?? p.aroma,
        taste: text?.taste ?? p.taste,
        bitterness: p.bitterness,
        pungency: p.pungency,
        pairings: text?.pairings ?? p.pairings,
        packaging: text?.packaging ?? p.packaging,
      },
      lab: (lot ? (lab.get(lot.id) ?? []) : []).map(({ testedAt, ...result }) => ({ ...result, tested: day(testedAt) })),
      variants: p.variants.map((v) => ({ sku: v.sku, ml: v.volumeMl, label: v.label, priceCents: v.priceCents, prices: allPrices(v), scale: bottleScale(v.volumeMl), inStock: v.stock - v.reserved > 0, backorder: p.allowBackorder && v.stock - v.reserved <= 0 })),
      facts: {
        origin: text?.origin ?? p.origin,
        cultivar: text?.cultivar ?? p.cultivar,
        ingredients: text?.ingredients ?? p.ingredients,
        storage: text?.storage ?? p.storage,
        nutrition: Array.isArray(p.nutrition) ? (p.nutrition as { label: string; value: string | null }[]) : [],
        harvest: day(lot?.harvestDate ?? null),
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

