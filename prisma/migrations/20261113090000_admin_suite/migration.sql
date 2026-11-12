-- Suppliers, wholesale accounts, staff two-factor sign-in, uploaded product photos.
CREATE TYPE "WholesaleStatus" AS ENUM ('NONE', 'REQUESTED', 'APPROVED', 'REJECTED');

CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'Other',
  "contactName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "countryCode" CHAR(2),
  "vatNumber" TEXT,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Supplier_isActive_name_idx" ON "Supplier"("isActive", "name");

ALTER TABLE "Batch" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Customer"
  ADD COLUMN "wholesaleStatus" "WholesaleStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "companyName" TEXT,
  ADD COLUMN "companyVatNumber" TEXT,
  ADD COLUMN "wholesaleDiscountBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "wholesaleNote" TEXT;

ALTER TABLE "AdminUser" ADD COLUMN "totpSecret" TEXT, ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "AdminSession" ADD COLUMN "userAgent" TEXT;

ALTER TABLE "ProductImage" ADD COLUMN "data" BYTEA, ADD COLUMN "mime" TEXT, ADD COLUMN "bytes" INTEGER;
