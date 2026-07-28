-- Extend the existing activity history in place. Existing IDs and metadata are
-- retained, and their business occurrence time starts as the original insert
-- time because no more precise historical timestamp is available.
CREATE TYPE "LeadActivityActorType" AS ENUM ('USER', 'CONTACT', 'SYSTEM', 'AI');
CREATE TYPE "LeadActivitySource" AS ENUM ('MANUAL', 'WEBSITE', 'GMAIL', 'INBOX', 'TASK', 'AI', 'SYSTEM');

ALTER TYPE "LeadActivityType" ADD VALUE 'CONVERSATION_IMPORTED';
ALTER TYPE "LeadActivityType" ADD VALUE 'CONVERSATION_STATUS_CHANGED';
ALTER TYPE "LeadActivityType" ADD VALUE 'AI_ANALYSIS_COMPLETED';

ALTER TABLE "LeadActivity"
  ADD COLUMN "actorType" "LeadActivityActorType" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "source" "LeadActivitySource" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "occurredAt" TIMESTAMP(3),
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "taskId" TEXT;

UPDATE "LeadActivity"
SET "occurredAt" = "createdAt"
WHERE "occurredAt" IS NULL;

UPDATE "LeadActivity" AS activity
SET "occurredAt" = message."receivedAt"
FROM "Message" AS message
WHERE activity."messageId" = message."id"
  AND activity."userId" = message."ownerId";

UPDATE "LeadActivity" AS activity
SET "taskId" = task."id"
FROM "Task" AS task
WHERE activity."metadata"->>'taskId' = task."id"
  AND activity."userId" = task."ownerId";

UPDATE "LeadActivity"
SET "source" = CASE
  WHEN "type" = 'WEBSITE_SUBMISSION_RECEIVED' THEN 'WEBSITE'::"LeadActivitySource"
  WHEN "type"::text LIKE 'TASK_%' THEN 'TASK'::"LeadActivitySource"
  WHEN "type" IN ('MESSAGE_RECEIVED', 'MESSAGE_SENT') THEN 'INBOX'::"LeadActivitySource"
  WHEN "type" IN ('CONVERSATION_LINKED', 'CONVERSATION_UNLINKED') THEN 'INBOX'::"LeadActivitySource"
  ELSE 'MANUAL'::"LeadActivitySource"
END,
"actorType" = CASE
  WHEN "type" = 'MESSAGE_RECEIVED' THEN 'CONTACT'::"LeadActivityActorType"
  WHEN "type" = 'WEBSITE_SUBMISSION_RECEIVED' THEN 'SYSTEM'::"LeadActivityActorType"
  ELSE 'USER'::"LeadActivityActorType"
END;

ALTER TABLE "LeadActivity"
  ALTER COLUMN "occurredAt" SET NOT NULL,
  ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "leadId" DROP NOT NULL;

ALTER TABLE "LeadActivity"
  DROP CONSTRAINT "LeadActivity_leadId_fkey";

ALTER TABLE "LeadActivity"
  ADD CONSTRAINT "LeadActivity_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LeadActivity_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "LeadActivity_leadId_createdAt_idx";
DROP INDEX IF EXISTS "LeadActivity_userId_createdAt_idx";
DROP INDEX IF EXISTS "LeadActivity_conversationId_createdAt_idx";
DROP INDEX IF EXISTS "LeadActivity_messageId_createdAt_idx";

CREATE UNIQUE INDEX "LeadActivity_userId_idempotencyKey_key"
  ON "LeadActivity"("userId", "idempotencyKey");
CREATE INDEX "LeadActivity_leadId_occurredAt_id_idx"
  ON "LeadActivity"("leadId", "occurredAt", "id");
CREATE INDEX "LeadActivity_userId_occurredAt_id_idx"
  ON "LeadActivity"("userId", "occurredAt", "id");
CREATE INDEX "LeadActivity_conversationId_occurredAt_id_idx"
  ON "LeadActivity"("conversationId", "occurredAt", "id");
CREATE INDEX "LeadActivity_taskId_occurredAt_id_idx"
  ON "LeadActivity"("taskId", "occurredAt", "id");
CREATE INDEX "LeadActivity_userId_type_occurredAt_id_idx"
  ON "LeadActivity"("userId", "type", "occurredAt", "id");
CREATE INDEX "LeadActivity_messageId_occurredAt_idx"
  ON "LeadActivity"("messageId", "occurredAt");
