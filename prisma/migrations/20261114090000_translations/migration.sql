-- One translation table for every kind of record, with a draft, a published copy and a history.
-- The two older per-table translation tables were never read by the application.
-- Any rows they hold are carried over as published translations before the tables are removed.
CREATE TABLE "Translation" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "sourceHash" TEXT,
    "updatedById" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Translation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Translation_entity_entityId_language_key" ON "Translation"("entity", "entityId", "language");
CREATE INDEX "Translation_entity_language_idx" ON "Translation"("entity", "language");

CREATE TABLE "TranslationRevision" (
    "id" TEXT NOT NULL,
    "translationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "adminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TranslationRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TranslationRevision_translationId_createdAt_idx" ON "TranslationRevision"("translationId", "createdAt");
ALTER TABLE "TranslationRevision" ADD CONSTRAINT "TranslationRevision_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "Translation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Translation" ("id", "entity", "entityId", "language", "draft", "published", "publishedAt", "updatedAt")
SELECT 'tr_' || t."id", 'product', t."productId", lower(left(t."locale", 2)),
       jsonb_strip_nulls(jsonb_build_object('name', t."name", 'blurb', t."blurb", 'description', t."description", 'seoTitle', t."seoTitle", 'seoDescription', t."seoDescription")),
       jsonb_strip_nulls(jsonb_build_object('name', t."name", 'blurb', t."blurb", 'description', t."description", 'seoTitle', t."seoTitle", 'seoDescription', t."seoDescription")),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ProductTranslation" t
WHERE lower(left(t."locale", 2)) <> 'en'
ON CONFLICT DO NOTHING;

INSERT INTO "Translation" ("id", "entity", "entityId", "language", "draft", "published", "publishedAt", "updatedAt")
SELECT 'tr_' || t."id", 'category', t."categoryId", lower(left(t."locale", 2)),
       jsonb_build_object('name', t."name", 'intro', t."intro"),
       jsonb_build_object('name', t."name", 'intro', t."intro"),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CategoryTranslation" t
WHERE lower(left(t."locale", 2)) <> 'en'
ON CONFLICT DO NOTHING;

DROP TABLE "ProductTranslation";
DROP TABLE "CategoryTranslation";
