-- A record of each attempt to book a shipment, written before the carrier is called.
CREATE TABLE "ShipmentAttempt" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "carrier" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STARTED',
  "shipmentId" TEXT,
  "error" TEXT,
  "adminUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShipmentAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShipmentAttempt_orderId_fingerprint_status_idx" ON "ShipmentAttempt"("orderId", "fingerprint", "status");
