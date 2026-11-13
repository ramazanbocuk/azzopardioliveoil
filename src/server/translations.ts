import { createHash } from "node:crypto";
import { LANGUAGES, LANGUAGE_NAME, isLanguage, languageOf, type Language } from "@/i18n/config";
import { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "./auth";
import type { Ctx } from "./context";
import type { Db } from "./db";
import { AppError } from "./errors";

/**
 * Translations of records (products, categories, journal posts).
 *
 * English is the source and lives on the record. Each other language has one
 * row holding a DRAFT, which editors work on, and a PUBLISHED copy, which is
 * the only thing customers ever see. Publishing is a separate, logged step
 * for a person with the right permission: nothing reaches the shop by being
 * typed or generated, only by being published.
 *
 * Interface text (buttons, labels) is not here; it lives in src/i18n/messages.
 */

export type Entity = "product" | "category" | "journal";
export const ENTITIES: Entity[] = ["product", "category", "journal"];
export const ENTITY_LABEL: Record<Entity, string> = { product: "Products", category: "Categories", journal: "Journal articles" };
export const TARGET_LANGUAGES = LANGUAGES.filter((language) => language !== "en");

type FieldSpec = { key: string; label: string; long?: boolean; max: number; required?: boolean; /** Food-label or otherwise regulated wording: must be checked by a qualified person before publishing. */ regulated?: boolean };

export const FIELDS: Record<Entity, FieldSpec[]> = {
  product: [
    { key: "name", label: "Name", max: 120, required: true },
    { key: "blurb", label: "Short description", max: 300 },
    { key: "description", label: "Description", long: true, max: 8000 },
    { key: "seoTitle", label: "Search title", max: 70 },
    { key: "seoDescription", label: "Search description", max: 170 },
    { key: "origin", label: "Origin", max: 200, regulated: true },
    { key: "cultivar", label: "Olive variety", max: 200, regulated: true },
    { key: "ingredients", label: "Ingredients", max: 500, regulated: true },
    { key: "storage", label: "Storage", max: 500, regulated: true },
    { key: "harvestMethod", label: "Harvesting method", max: 300 },
    { key: "extractionMethod", label: "Extraction method", max: 300, regulated: true },
    { key: "aroma", label: "Aroma", long: true, max: 600 },
    { key: "taste", label: "Taste", long: true, max: 600 },
    { key: "pairings", label: "Food pairings", long: true, max: 600 },
    { key: "packaging", label: "Packaging", max: 300 },
    { key: "backorderNote", label: "Note about the wait when out of stock", max: 200 },
  ],
  category: [
    { key: "name", label: "Name", max: 120, required: true },
    { key: "intro", label: "Introduction", long: true, max: 2000 },
  ],
  journal: [
    { key: "title", label: "Title", max: 200, required: true },
    { key: "standfirst", label: "Standfirst", max: 500 },
    { key: "body", label: "Body", long: true, max: 40000 },
  ],
};

export type Fields = Record<string, string>;

/** Keeps only this entity's fields, trimmed, without empty ones. */
function clean(entity: Entity, input: unknown): Fields {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Fields = {};
  for (const field of FIELDS[entity]) {
    const value = typeof source[field.key] === "string" ? (source[field.key] as string).trim() : "";
    if (value.length > field.max) throw new AppError("BAD_INPUT", `${field.label}: use at most ${field.max} characters.`);
    if (value) out[field.key] = value;
  }
  return out;
}

const fingerprint = (fields: Fields) => createHash("sha256").update(JSON.stringify(Object.entries(fields).sort())).digest("hex").slice(0, 16);

type SourceRow = { id: string; title: string; slug: string; fields: Fields };

async function sources(db: Db, entity: Entity, id?: string): Promise<SourceRow[]> {
  const pick = (row: Record<string, unknown>) => clean(entity, row);
  if (entity === "product") {
    const rows = await db.product.findMany({ where: { deletedAt: null, ...(id ? { id } : {}) }, orderBy: [{ position: "asc" }, { name: "asc" }] });
    return rows.map((row) => ({ id: row.id, title: row.name, slug: row.slug, fields: pick(row) }));
  }
  if (entity === "category") {
    const rows = await db.category.findMany({ where: id ? { id } : {}, orderBy: { position: "asc" } });
    return rows.map((row) => ({ id: row.id, title: row.name, slug: row.slug, fields: pick(row) }));
  }
  const rows = await db.journalPost.findMany({ where: id ? { id } : {}, orderBy: { createdAt: "desc" } });
  return rows.map((row) => ({ id: row.id, title: row.title, slug: row.slug, fields: pick(row) }));
}

export type TranslationState = "missing" | "draft" | "published" | "outdated" | "changed";
export const STATE_LABEL: Record<TranslationState, string> = {
  missing: "Not started",
  draft: "Draft, not published",
  published: "Published",
  outdated: "Published, English changed since",
  changed: "Published, newer draft waiting",
};

function stateOf(row: { draft: unknown; published: unknown; sourceHash: string | null } | undefined, source: Fields): TranslationState {
  if (!row) return "missing";
  if (!row.published) return "draft";
  if (row.sourceHash !== fingerprint(source)) return "outdated";
  return JSON.stringify(row.draft) === JSON.stringify(row.published) ? "published" : "changed";
}

/** The missing-translation report: every record against every language. */
export async function translationOverview(ctx: Ctx) {
  requireAdmin(ctx, "VIEW", "content");
  const rows = await ctx.db.translation.findMany({ select: { entity: true, entityId: true, language: true, draft: true, published: true, sourceHash: true, updatedAt: true } });
  const byKey = new Map(rows.map((row) => [`${row.entity}:${row.entityId}:${row.language}`, row]));
  const groups = await Promise.all(
    ENTITIES.map(async (entity) => {
      const records = await sources(ctx.db, entity);
      return {
        entity,
        label: ENTITY_LABEL[entity],
        records: records.map((record) => ({
          id: record.id,
          title: record.title,
          states: Object.fromEntries(TARGET_LANGUAGES.map((language) => [language, stateOf(byKey.get(`${entity}:${record.id}:${language}`), record.fields)])) as Record<Language, TranslationState>,
        })),
      };
    }),
  );
  const totals = Object.fromEntries(
    TARGET_LANGUAGES.map((language) => {
      const states = groups.flatMap((group) => group.records.map((record) => record.states[language]));
      return [language, { total: states.length, live: states.filter((state) => state !== "missing" && state !== "draft").length, attention: states.filter((state) => state === "outdated" || state === "changed" || state === "draft").length, missing: states.filter((state) => state === "missing").length }];
    }),
  ) as Record<Language, { total: number; live: number; attention: number; missing: number }>;
  return { groups, totals, languages: TARGET_LANGUAGES.map((language) => ({ code: language, name: LANGUAGE_NAME[language] })) };
}

function target(entity: string, language: string): { entity: Entity; language: Language } {
  if (!ENTITIES.includes(entity as Entity)) throw new AppError("NOT_FOUND", "Nothing to translate there.");
  if (!isLanguage(language) || language === "en") throw new AppError("BAD_INPUT", "Choose a language other than English.");
  return { entity: entity as Entity, language };
}

/** One record in one language, with the English beside it and the history of changes. */
export async function getTranslation(ctx: Ctx, entityName: string, entityId: string, languageName: string) {
  requireAdmin(ctx, "VIEW", "content");
  const { entity, language } = target(entityName, languageName);
  const [record] = await sources(ctx.db, entity, entityId);
  if (!record) throw new AppError("NOT_FOUND", "That record no longer exists.");
  const row = await ctx.db.translation.findUnique({ where: { entity_entityId_language: { entity, entityId, language } }, include: { revisions: { orderBy: { createdAt: "desc" }, take: 30 } } });
  const staffIds = [...new Set((row?.revisions ?? []).map((revision) => revision.adminUserId).filter((id): id is string => !!id))];
  const staff = new Map((await ctx.db.adminUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]));
  return {
    entity,
    language,
    languageName: LANGUAGE_NAME[language],
    record,
    fields: FIELDS[entity],
    draft: (row?.draft ?? {}) as Fields,
    published: (row?.published ?? null) as Fields | null,
    publishedAt: row?.publishedAt ?? null,
    state: stateOf(row ?? undefined, record.fields),
    history: (row?.revisions ?? []).map((revision) => ({ id: revision.id, action: revision.action, at: revision.createdAt, by: revision.adminUserId ? (staff.get(revision.adminUserId) ?? "Former staff") : "System", fields: revision.fields as Fields })),
  };
}

const audit = (ctx: Ctx, action: string, entityId: string, data: object) => ctx.db.auditLog.create({ data: { actorType: "admin", actorId: ctx.admin?.id ?? null, action, entity: "Translation", entityId, data, ip: ctx.ip } });

/** Saves the working copy. Nothing changes for customers. */
export async function saveTranslationDraft(ctx: Ctx, entityName: string, entityId: string, languageName: string, input: unknown) {
  const admin = requireAdmin(ctx, "STAFF", "content");
  const { entity, language } = target(entityName, languageName);
  const [record] = await sources(ctx.db, entity, entityId);
  if (!record) throw new AppError("NOT_FOUND", "That record no longer exists.");
  const draft = clean(entity, input);
  const row = await ctx.db.translation.upsert({ where: { entity_entityId_language: { entity, entityId, language } }, create: { entity, entityId, language, draft, updatedById: admin.id }, update: { draft, updatedById: admin.id } });
  await ctx.db.translationRevision.create({ data: { translationId: row.id, action: "draft", fields: draft, adminUserId: admin.id } });
  await audit(ctx, "translation.draft", row.id, { entity, entityId, language });
  return row.id;
}

/**
 * Makes the current draft what customers see. Managers only. Required fields
 * must be filled, so a published page can never have an empty title.
 */
export async function publishTranslation(ctx: Ctx, entityName: string, entityId: string, languageName: string) {
  const admin = requireAdmin(ctx, "MANAGER", "content");
  const { entity, language } = target(entityName, languageName);
  const [record] = await sources(ctx.db, entity, entityId);
  const row = await ctx.db.translation.findUnique({ where: { entity_entityId_language: { entity, entityId, language } } });
  if (!record || !row) throw new AppError("BAD_INPUT", "Save a draft before publishing.");
  const draft = clean(entity, row.draft);
  const missing = FIELDS[entity].filter((field) => field.required && !draft[field.key]);
  if (missing.length) throw new AppError("BAD_INPUT", `Fill in ${missing.map((field) => field.label.toLowerCase()).join(", ")} before publishing.`);
  await ctx.db.translation.update({ where: { id: row.id }, data: { published: draft, sourceHash: fingerprint(record.fields), publishedAt: new Date(), publishedById: admin.id } });
  await ctx.db.translationRevision.create({ data: { translationId: row.id, action: "publish", fields: draft, adminUserId: admin.id } });
  await audit(ctx, "translation.publish", row.id, { entity, entityId, language });
}

/** Takes a translation off the shop; customers see English again. The draft is kept. */
export async function unpublishTranslation(ctx: Ctx, entityName: string, entityId: string, languageName: string) {
  const admin = requireAdmin(ctx, "MANAGER", "content");
  const { entity, language } = target(entityName, languageName);
  const row = await ctx.db.translation.findUnique({ where: { entity_entityId_language: { entity, entityId, language } } });
  if (!row?.published) throw new AppError("BAD_INPUT", "This translation is not published.");
  await ctx.db.translation.update({ where: { id: row.id }, data: { published: Prisma.DbNull, sourceHash: null, publishedAt: null, publishedById: null } });
  await ctx.db.translationRevision.create({ data: { translationId: row.id, action: "unpublish", fields: row.published as Fields, adminUserId: admin.id } });
  await audit(ctx, "translation.unpublish", row.id, { entity, entityId, language });
}

/**
 * Published translations of an entity in a language, by record id. Used by
 * the shop. English, or a language with nothing published, returns an empty map.
 */
export async function publishedTranslations(db: Db, entity: Entity, language: string): Promise<Map<string, Fields>> {
  if (language === "en" || !isLanguage(language)) return new Map();
  const rows = await db.translation.findMany({ where: { entity, language, NOT: { publishedAt: null } }, select: { entityId: true, published: true } });
  return new Map(rows.filter((row) => row.published).map((row) => [row.entityId, row.published as Fields]));
}

/** For each record, the languages it is published in (English always). Used for hreflang and the sitemap. */
export async function publishedLanguages(db: Db, entity: Entity): Promise<Map<string, Language[]>> {
  const rows = await db.translation.findMany({ where: { entity, NOT: { publishedAt: null } }, select: { entityId: true, language: true } });
  const map = new Map<string, Language[]>();
  for (const row of rows) if (isLanguage(row.language)) map.set(row.entityId, [...(map.get(row.entityId) ?? ["en"]), row.language]);
  return map;
}

const perRequest = new WeakMap<object, Map<string, Promise<Map<string, Fields>>>>();

/**
 * The published text of one record in the language of the current request.
 * An empty object means "use the English on the record". Translations are
 * loaded once per entity per request, however many records ask.
 */
export async function textOf(ctx: Ctx, entity: Entity, id: string): Promise<Fields> {
  const language = ctx.locale ? languageOf(ctx.locale) : "en";
  if (language === "en") return {};
  let cache = perRequest.get(ctx);
  if (!cache) perRequest.set(ctx, (cache = new Map()));
  let loading = cache.get(entity);
  if (!loading) cache.set(entity, (loading = publishedTranslations(ctx.db, entity, language)));
  return (await loading).get(id) ?? {};
}
