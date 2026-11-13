import type { MetadataRoute } from "next";
import { siteUrl } from "@/components/ui/JsonLd";
import { journal } from "@/content/site";
import { DEFAULT_LOCALE, LANGUAGES, LOCALES, LOCALE_CODES, languageOf, localizePath, type Language } from "@/i18n/config";
import { ENGLISH_ONLY } from "@/i18n/seo";
import { getCatalogData, getJournalEntries } from "@/server/storefrontData";

/** Pages translated in every language, and pages whose text is still English only. */
const TRANSLATED = ["/shop", "/contact"];
const ENGLISH_PAGES = ["", "/our-story", "/olive-groves", "/harvest-production", "/quality-traceability", "/journal", "/faq", "/shipping-returns", "/privacy-policy", "/cookie-policy", "/terms-conditions"];

/**
 * Public, indexable pages only. Cart, checkout, account and admin are left
 * out on purpose. Each page is listed once per locale it really exists in,
 * with its language alternates, so search engines can send a German reader
 * to the German address. A page that is still English is listed under the
 * English locales only.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [{ categories, products }, { entries }] = await Promise.all([getCatalogData(), getJournalEntries()]);

  const page = (path: string, languages: readonly Language[], priority: number, changeFrequency: "weekly" | "monthly" = "weekly"): MetadataRoute.Sitemap => {
    const locales = LOCALE_CODES.filter((code) => languages.includes(languageOf(code)));
    const alternates = { languages: { ...Object.fromEntries(locales.map((code) => [LOCALES[code].tag, `${base}${localizePath(code, path || "/")}`])), "x-default": `${base}${localizePath(DEFAULT_LOCALE, path || "/")}` } };
    return locales.map((code) => ({ url: `${base}${localizePath(code, path || "/")}`, changeFrequency, priority, alternates }));
  };

  return [
    ...TRANSLATED.flatMap((path) => page(path, LANGUAGES, 0.8)),
    ...ENGLISH_PAGES.flatMap((path) => page(path, ENGLISH_ONLY, path === "" ? 1 : 0.6)),
    ...categories.flatMap((category) => page(`/shop/${category.slug}`, category.languages as Language[], 0.8)),
    ...products.flatMap((product) => page(`/products/${product.slug}`, product.languages as Language[], 0.9)),
    ...[...entries, ...journal.filter((entry) => !entries.some((other) => other.slug === entry.slug))].flatMap((entry) => page(`/journal/${entry.slug}`, (entry.languages ?? ["en"]) as Language[], 0.5, "monthly")),
  ];
}
