-- Order lifecycle: headline status gains five states, FULFILLING becomes PROCESSING.
ALTER TYPE "OrderStatus" RENAME VALUE 'FULFILLING' TO 'PROCESSING';
ALTER TYPE "OrderStatus" ADD VALUE 'PAYMENT_PROCESSING' AFTER 'PENDING_PAYMENT';
ALTER TYPE "OrderStatus" ADD VALUE 'READY_FOR_FULFILMENT' AFTER 'PROCESSING';
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_SHIPPED' AFTER 'READY_FOR_FULFILMENT';
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'PROCESSING' AFTER 'UNPAID';

CREATE TYPE "FulfilmentStatus" AS ENUM ('UNFULFILLED', 'PROCESSING', 'READY', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED');

-- Orders: fulfilment state, VAT on shipping, billing address.
ALTER TABLE "Order"
  ADD COLUMN "fulfilmentStatus" "FulfilmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
  ADD COLUMN "shippingTaxCents" INTEGER,
  ADD COLUMN "billFirstName" TEXT,
  ADD COLUMN "billLastName" TEXT,
  ADD COLUMN "billCompany" TEXT,
  ADD COLUMN "billVatNumber" TEXT,
  ADD COLUMN "billLine1" TEXT,
  ADD COLUMN "billLine2" TEXT,
  ADD COLUMN "billPostalCode" TEXT,
  ADD COLUMN "billCity" TEXT,
  ADD COLUMN "billRegion" TEXT,
  ADD COLUMN "billCountryCode" CHAR(2);

-- Existing orders were billed to the delivery address.
UPDATE "Order" SET
  "billFirstName" = "shipFirstName", "billLastName" = "shipLastName", "billLine1" = "shipLine1", "billLine2" = "shipLine2",
  "billPostalCode" = "shipPostalCode", "billCity" = "shipCity", "billRegion" = "shipRegion", "billCountryCode" = "shipCountryCode";

UPDATE "Order" SET "fulfilmentStatus" = CASE "status"::text
  WHEN 'PROCESSING' THEN 'PROCESSING' WHEN 'SHIPPED' THEN 'SHIPPED' WHEN 'DELIVERED' THEN 'DELIVERED' ELSE 'UNFULFILLED' END::"FulfilmentStatus";

UPDATE "Order" SET "shippingTaxCents" = ROUND(("shippingCents"::numeric * "taxRateBps") / (10000 + "taxRateBps")) WHERE "taxRateBps" IS NOT NULL;

ALTER TABLE "Order"
  ALTER COLUMN "billFirstName" SET NOT NULL, ALTER COLUMN "billLastName" SET NOT NULL, ALTER COLUMN "billLine1" SET NOT NULL,
  ALTER COLUMN "billPostalCode" SET NOT NULL, ALTER COLUMN "billCity" SET NOT NULL, ALTER COLUMN "billCountryCode" SET NOT NULL;

CREATE INDEX "Order_fulfilmentStatus_placedAt_idx" ON "Order"("fulfilmentStatus", "placedAt");

-- Order lines: VAT, shipped units, customs snapshot.
ALTER TABLE "OrderItem"
  ADD COLUMN "taxRateBps" INTEGER,
  ADD COLUMN "taxCents" INTEGER,
  ADD COLUMN "shippedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "weightGrams" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hsCode" TEXT,
  ADD COLUMN "originCountry" CHAR(2);

-- Line VAT for existing orders. Undiscounted orders only: a discount was not recorded per line, so those stay null rather than guessed.
UPDATE "OrderItem" i SET "taxRateBps" = o."taxRateBps", "taxCents" = ROUND((i."lineTotalCents"::numeric * o."taxRateBps") / (10000 + o."taxRateBps"))
  FROM "Order" o WHERE o."id" = i."orderId" AND o."taxRateBps" IS NOT NULL AND o."discountCents" = 0;
UPDATE "OrderItem" i SET "shippedQuantity" = i."quantity" FROM "Order" o WHERE o."id" = i."orderId" AND o."fulfilmentStatus" IN ('SHIPPED', 'DELIVERED');
UPDATE "OrderItem" i SET "weightGrams" = v."weightGrams" FROM "Variant" v WHERE v."id" = i."variantId";

-- Timeline: who did it, and whether the customer may see it.
ALTER TABLE "OrderEvent" ADD COLUMN "adminUserId" TEXT, ADD COLUMN "isInternal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Products: customs facts.
ALTER TABLE "Product" ADD COLUMN "hsCode" TEXT, ADD COLUMN "customsDescription" TEXT, ADD COLUMN "originCountry" CHAR(2);

-- Shipments: service, carrier reference, cost, estimate, who booked it.
ALTER TABLE "Shipment"
  ADD COLUMN "service" TEXT,
  ADD COLUMN "carrierRef" TEXT,
  ADD COLUMN "costCents" INTEGER,
  ADD COLUMN "estimatedDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "adminUserId" TEXT;

CREATE TABLE "Parcel" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "weightGrams" INTEGER NOT NULL,
  "lengthMm" INTEGER,
  "widthMm" INTEGER,
  "heightMm" INTEGER,
  "trackingNumber" TEXT,
  CONSTRAINT "Parcel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Parcel_shipmentId_idx" ON "Parcel"("shipmentId");
ALTER TABLE "Parcel" ADD CONSTRAINT "Parcel_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ShipmentItem" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShipmentItem_shipmentId_orderItemId_key" ON "ShipmentItem"("shipmentId", "orderItemId");
CREATE INDEX "ShipmentItem_orderItemId_idx" ON "ShipmentItem"("orderItemId");
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
