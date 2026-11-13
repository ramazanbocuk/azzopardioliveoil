-- Refunds and disputes made at the payment provider are mirrored here.
-- Nothing is deleted. If two existing refunds share a provider reference,
-- the later one loses its reference so the unique index can be built; the row and its amount stay.
ALTER TABLE "Payment" ADD COLUMN "intentRef" TEXT;
CREATE INDEX "Payment_intentRef_idx" ON "Payment"("intentRef");

ALTER TABLE "Refund" ADD COLUMN "failedAt" TIMESTAMP(3);
UPDATE "Refund" r SET "providerRef" = NULL
WHERE "providerRef" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Refund" o WHERE o."providerRef" = r."providerRef" AND (o."createdAt", o."id") < (r."createdAt", r."id"));
CREATE UNIQUE INDEX "Refund_providerRef_key" ON "Refund"("providerRef");

CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "evidenceDueAt" TIMESTAMP(3),
    "providerAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Dispute_providerRef_key" ON "Dispute"("providerRef");
CREATE INDEX "Dispute_paymentId_idx" ON "Dispute"("paymentId");
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
