-- Tracking events as rows, and a marker for a parcel the carrier reports a problem with. Additive.
ALTER TABLE "Shipment" ADD COLUMN "exceptionAt" TIMESTAMP(3), ADD COLUMN "exceptionNote" TEXT;

CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "code" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'INFO',
    "source" TEXT NOT NULL DEFAULT 'carrier',
    "adminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrackingEvent_shipmentId_occurredAt_description_key" ON "TrackingEvent"("shipmentId", "occurredAt", "description");
CREATE INDEX "TrackingEvent_shipmentId_occurredAt_idx" ON "TrackingEvent"("shipmentId", "occurredAt");
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Events already read from carriers are carried over from the JSON column, which stays in place.
INSERT INTO "TrackingEvent" ("id", "shipmentId", "occurredAt", "description", "location")
SELECT 'te_' || md5(s."id" || (e ->> 'at') || (e ->> 'description')), s."id", (e ->> 'at')::timestamp, e ->> 'description', NULLIF(e ->> 'location', '')
FROM "Shipment" s, jsonb_array_elements(CASE WHEN jsonb_typeof(s."trackingEvents") = 'array' THEN s."trackingEvents" ELSE '[]'::jsonb END) AS e
WHERE (e ->> 'at') IS NOT NULL AND (e ->> 'description') IS NOT NULL
ON CONFLICT DO NOTHING;
