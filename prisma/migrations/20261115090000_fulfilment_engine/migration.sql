-- Backorders, a record of each stock hold, and the lot of each shipped line. Additive only.
ALTER TABLE "Product" ADD COLUMN "allowBackorder" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "backorderNote" TEXT;

ALTER TABLE "OrderItem" ADD COLUMN "backorderQuantity" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "cancelledQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantities_consistent" CHECK ("backorderQuantity" >= 0 AND "cancelledQuantity" >= 0 AND "backorderQuantity" <= "quantity" AND "shippedQuantity" + "cancelledQuantity" <= "quantity");

ALTER TABLE "ShipmentItem" ADD COLUMN "lotNumber" TEXT;
-- Existing shipments carry the lot recorded on their order line.
UPDATE "ShipmentItem" s SET "lotNumber" = i."lotNumber" FROM "OrderItem" i WHERE i."id" = s."orderItemId" AND i."lotNumber" IS NOT NULL;

CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'CONVERTED', 'RELEASED');
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockReservation_variantId_status_idx" ON "StockReservation"("variantId", "status");
CREATE INDEX "StockReservation_orderId_idx" ON "StockReservation"("orderId");
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Orders that are awaiting payment right now get a record of the hold they already have.
INSERT INTO "StockReservation" ("id", "orderId", "orderItemId", "variantId", "quantity", "status", "expiresAt")
SELECT 'sr_' || i."id", o."id", i."id", i."variantId", i."quantity", 'HELD', o."reservedUntil"
FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
WHERE o."cancelledAt" IS NULL AND o."reservedUntil" IS NOT NULL AND o."paymentStatus" IN ('UNPAID', 'FAILED', 'PROCESSING') AND i."variantId" IS NOT NULL;

CREATE TABLE "Backorder" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "filledQuantity" INTEGER NOT NULL DEFAULT 0,
    "cancelledQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "Backorder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Backorder_orderItemId_key" ON "Backorder"("orderItemId");
CREATE INDEX "Backorder_variantId_closedAt_createdAt_idx" ON "Backorder"("variantId", "closedAt", "createdAt");
CREATE INDEX "Backorder_orderId_idx" ON "Backorder"("orderId");
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Backorder" ADD CONSTRAINT "Backorder_quantities_consistent" CHECK ("quantity" > 0 AND "filledQuantity" >= 0 AND "cancelledQuantity" >= 0 AND "filledQuantity" + "cancelledQuantity" <= "quantity");
