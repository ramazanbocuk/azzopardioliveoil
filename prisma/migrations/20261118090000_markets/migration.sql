-- Markets: a group of delivery countries sold to in one currency.
-- The euro is the base: a country in no market is sold to in euro, at the
-- price on the variant, exactly as before this migration. Nothing is converted.
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "countries" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Market_code_key" ON "Market"("code");

-- The price of a size in a currency other than euro, set by the owner.
CREATE TABLE "VariantPrice" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VariantPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VariantPrice_variantId_currency_key" ON "VariantPrice"("variantId", "currency");
ALTER TABLE "VariantPrice" ADD CONSTRAINT "VariantPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing rows keep their meaning: every amount so far was in euro.
ALTER TABLE "ShippingZone" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'EUR';
ALTER TABLE "Discount" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'EUR';
ALTER TABLE "Product" ADD COLUMN "excludedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[];
