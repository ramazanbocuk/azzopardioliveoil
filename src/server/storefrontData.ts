import { cacheLife, cacheTag } from "next/cache";
import { journal, type CatalogItem, type Category, type JournalEntry, type Product } from "@/content/site";
import { getPrisma } from "./db";
import { loadCatalog } from "./catalogView";
import { publishedLanguages, publishedTranslations } from "./translations";

/**
 * Catalogue data for server-rendered pages, read straight from the database
 * (no HTTP hop) and cached. Admin changes call `revalidateTag("catalog")`;
 * otherwise entries refresh within minutes, which bounds how stale an
 * "in stock" badge can be. The cart and checkout always re-check live stock.
 */

/**
 * Catalogue data for pages, cached for a few minutes. See catalogView.ts for
 * what it contains and how translations are applied.
 */
export async function getCatalogData(language = "en"): Promise<{ categories: Category[]; products: Product[]; items: CatalogItem[] }> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  return loadCatalog(getPrisma(), language);
}

/** Lowest free-shipping threshold among active rates, for "free from €X" messaging. Null if none. */
export async function getFreeShippingThreshold(): Promise<number | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("shipping");
  const rate = await getPrisma().shippingRate.findFirst({ where: { isActive: true, freeAboveCents: { not: null }, zone: { isActive: true } }, orderBy: { freeAboveCents: "asc" } });
  return rate?.freeAboveCents ?? null;
}

/**
 * Journal entries for the shop: articles published from the admin panel,
 * newest first, followed by the built-in sample entries. `fromAdmin` tells
 * the pages whether real articles exist, so the "draft" notice can go.
 */
export async function getJournalEntries(language = "en"): Promise<{ entries: JournalEntry[]; fromAdmin: number }> {
  "use cache";
  cacheLife("minutes");
  cacheTag("journal");
  const tones = ["olive", "terracotta", "gold", "stone", "dawn"] as const;
  const db = getPrisma();
  const [posts, texts, languages] = await Promise.all([db.journalPost.findMany({ where: { isPublished: true }, orderBy: { publishedAt: "desc" }, take: 60 }), publishedTranslations(db, "journal", language), publishedLanguages(db, "journal")]);
  const published: JournalEntry[] = posts.map((post, index) => ({
    slug: post.slug,
    kind: post.kind === "Recipe" ? "Recipe" : "Story",
    kicker: post.kind,
    title: texts.get(post.id)?.title ?? post.title,
    tone: tones[index % tones.length],
    label: post.title.toLowerCase(),
    standfirst: texts.get(post.id)?.standfirst ?? post.standfirst,
    languages: languages.get(post.id) ?? ["en"],
    body: (texts.get(post.id)?.body ?? post.body).split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean),
  }));
  const taken = new Set(published.map((entry) => entry.slug));
  return { entries: [...published, ...journal.filter((entry) => !taken.has(entry.slug))], fromAdmin: published.length };
}

/** The announcement line set under Website content, or null when it is off or empty. */
export async function getAnnouncement(): Promise<{ text: string; link: string | null } | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("content");
  const value = ((await getPrisma().setting.findUnique({ where: { key: "content" } }))?.value ?? {}) as { announcement?: string | null; announcementLink?: string | null; announcementOn?: boolean };
  return value.announcementOn && value.announcement ? { text: value.announcement, link: value.announcementLink ?? null } : null;
}

/**
 * Countries the shop delivers to: every country in an active shipping zone
 * that has at least one active rate. Names come from the platform's own
 * country list, so a zone can hold any ISO code. Belgium first, then A–Z.
 */
export async function getShippingCountries(): Promise<{ code: string; name: string }[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("shipping");
  const zones = await getPrisma().shippingZone.findMany({ where: { isActive: true, rates: { some: { isActive: true } } }, select: { countries: true } });
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const codes = [...new Set(zones.flatMap((zone) => zone.countries))].filter((code) => /^[A-Z]{2}$/.test(code));
  return codes
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => (a.code === "BE" ? -1 : b.code === "BE" ? 1 : a.name.localeCompare(b.name)));
}
