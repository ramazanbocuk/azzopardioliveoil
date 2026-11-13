-- Unhandled server errors, one row per distinct error, so staff can see and
-- be told about failures without an outside error-tracking service.
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "route" TEXT,
    "kind" TEXT,
    "method" TEXT,
    "lastPath" TEXT,
    "lastDigest" TEXT,
    "stack" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ErrorEvent_fingerprint_key" ON "ErrorEvent"("fingerprint");
CREATE INDEX "ErrorEvent_resolvedAt_lastSeenAt_idx" ON "ErrorEvent"("resolvedAt", "lastSeenAt");
