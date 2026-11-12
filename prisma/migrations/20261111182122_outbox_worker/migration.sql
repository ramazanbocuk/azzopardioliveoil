-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'SKIPPED';

-- AlterTable
ALTER TABLE "OutboxJob" ADD COLUMN     "lockedAt" TIMESTAMP(3);
