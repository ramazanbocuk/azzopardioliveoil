import type { MetadataRoute } from "next";
import { siteUrl } from "@/components/ui/JsonLd";
import { journal } from "@/content/site";
import { getCatalogData } from "@/server/storefrontData";

const STATIC = ["", "/shop", "/our-story", "/olive-groves", "/harvest-production", "/quality-traceability", "/journal", "/contact", "/faq", "/shipping-returns", "/privacy-policy", "/cookie-policy", "/terms-conditions"];

/** Public, indexable pages only. Cart, checkout, account and admin are left out on purpose. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const { categories, products } = await getCatalogData();
  return [
    ...STATIC.map((path) => ({ url: `${base}${path}`, changeFrequency: "weekly" as const, priority: path === "" ? 1 : 0.6 })),
    ...categories.map((category) => ({ url: `${base}/shop/${category.slug}`, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...products.map((product) => ({ url: `${base}/products/${product.slug}`, changeFrequency: "weekly" as const, priority: 0.9 })),
    ...journal.map((entry) => ({ url: `${base}/journal/${entry.slug}`, changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
