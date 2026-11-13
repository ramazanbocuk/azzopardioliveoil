-- Something the staff assistant suggested doing. Nothing happens until a
-- person with the right role approves it; then the same service the admin
-- panel uses is run, as that person.
CREATE TABLE "AiProposal" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "conversationId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiProposal_sequence_key" ON "AiProposal"("sequence");
CREATE INDEX "AiProposal_adminUserId_status_idx" ON "AiProposal"("adminUserId", "status");
CREATE INDEX "AiProposal_conversationId_idx" ON "AiProposal"("conversationId");
CREATE INDEX "AiProposal_status_createdAt_idx" ON "AiProposal"("status", "createdAt");
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AiConversation_adminUserId_idx" ON "AiConversation"("adminUserId");
