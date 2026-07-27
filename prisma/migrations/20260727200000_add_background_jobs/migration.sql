CREATE TYPE "JobType" AS ENUM ('GMAIL_SYNC');
CREATE TYPE "JobStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'RETRY_SCHEDULED',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "Job" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "type" "JobType" NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "result" JSONB,
  "progress" JSONB,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "heartbeatAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Job_ownerId_type_idempotencyKey_key"
  ON "Job"("ownerId", "type", "idempotencyKey");

CREATE INDEX "Job_status_availableAt_createdAt_id_idx"
  ON "Job"("status", "availableAt", "createdAt", "id");

CREATE INDEX "Job_status_heartbeatAt_lockedAt_id_idx"
  ON "Job"("status", "heartbeatAt", "lockedAt", "id");

CREATE INDEX "Job_ownerId_type_createdAt_id_idx"
  ON "Job"("ownerId", "type", "createdAt", "id");
