-- Carrier bookings: where a shipment came from, its tracking history, cancellation, and the labels the carrier issued.
ALTER TYPE "ShipmentStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "Shipment"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "trackingEvents" JSONB,
  ADD COLUMN "trackingCheckedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE TABLE "ShipmentLabel" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "mime" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "trackingNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShipmentLabel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShipmentLabel_shipmentId_position_idx" ON "ShipmentLabel"("shipmentId", "position");
ALTER TABLE "ShipmentLabel" ADD CONSTRAINT "ShipmentLabel_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
