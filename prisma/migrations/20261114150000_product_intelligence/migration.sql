-- Provenance and laboratory data: producers, regions, olive varieties, a tasting profile per product,
-- a harvest year per batch, uploaded certificates and measured values per batch. Additive only.
CREATE TYPE "OilComposition" AS ENUM ('SINGLE_VARIETY', 'BLEND');

CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Region_countryCode_name_key" ON "Region"("countryCode", "name");

CREATE TABLE "Producer" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" CHAR(2),
    "regionId" TEXT,
    "town" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "website" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Producer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Producer_slug_key" ON "Producer"("slug");
ALTER TABLE "Producer" ADD CONSTRAINT "Producer_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OliveVariety" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OliveVariety_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OliveVariety_slug_key" ON "OliveVariety"("slug");
CREATE UNIQUE INDEX "OliveVariety_name_key" ON "OliveVariety"("name");

CREATE TABLE "ProductVariety" (
    "productId" TEXT NOT NULL,
    "varietyId" TEXT NOT NULL,
    "percent" INTEGER,
    CONSTRAINT "ProductVariety_pkey" PRIMARY KEY ("productId", "varietyId")
);
CREATE INDEX "ProductVariety_varietyId_idx" ON "ProductVariety"("varietyId");
ALTER TABLE "ProductVariety" ADD CONSTRAINT "ProductVariety_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariety" ADD CONSTRAINT "ProductVariety_varietyId_fkey" FOREIGN KEY ("varietyId") REFERENCES "OliveVariety"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product"
  ADD COLUMN "producerId" TEXT,
  ADD COLUMN "regionId" TEXT,
  ADD COLUMN "composition" "OilComposition",
  ADD COLUMN "extractionMethod" TEXT,
  ADD COLUMN "harvestMethod" TEXT,
  ADD COLUMN "aroma" TEXT,
  ADD COLUMN "taste" TEXT,
  ADD COLUMN "bitterness" INTEGER,
  ADD COLUMN "pungency" INTEGER,
  ADD COLUMN "pairings" TEXT,
  ADD COLUMN "packaging" TEXT;
ALTER TABLE "Product" ADD CONSTRAINT "Product_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "Producer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_bitterness_range" CHECK ("bitterness" IS NULL OR "bitterness" BETWEEN 0 AND 5);
ALTER TABLE "Product" ADD CONSTRAINT "Product_pungency_range" CHECK ("pungency" IS NULL OR "pungency" BETWEEN 0 AND 5);

ALTER TABLE "Batch" ADD COLUMN "harvestYear" INTEGER, ADD COLUMN "producerId" TEXT;
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "Producer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BatchDocument" ADD COLUMN "data" BYTEA, ADD COLUMN "mime" TEXT, ADD COLUMN "bytes" INTEGER, ADD COLUMN "uploadedById" TEXT;

CREATE TABLE "LabResult" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "label" TEXT,
    "value" DECIMAL(12,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "method" TEXT,
    "laboratory" TEXT,
    "testedAt" DATE,
    "documentId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LabResult_batchId_idx" ON "LabResult"("batchId");
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BatchDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_value_not_negative" CHECK ("value" >= 0);
