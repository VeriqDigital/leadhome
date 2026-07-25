CREATE TYPE "ConversationClassification" AS ENUM ('UNKNOWN', 'LEAD', 'CUSTOMER', 'NEWSLETTER', 'SPAM', 'INTERNAL', 'SYSTEM');
CREATE TYPE "ConversationReviewState" AS ENUM ('NEEDS_REVIEW', 'MATCHED', 'IGNORED', 'RESOLVED');
CREATE TYPE "ConversationMatchKind" AS ENUM ('MATCHED', 'AMBIGUOUS', 'NO_MATCH');
CREATE TYPE "ConversationStatus_new" AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');

ALTER TABLE "CommunicationAccount"
  ADD COLUMN "lastImportedAt" TIMESTAMP(3),
  ADD COLUMN "lastImportSummary" JSONB;

ALTER TABLE "Conversation"
  ADD COLUMN "classification" "ConversationClassification" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "classificationIsManual" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewState" "ConversationReviewState" NOT NULL DEFAULT 'NEEDS_REVIEW',
  ADD COLUMN "manuallyDetached" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "providerMetadata" JSONB,
  ADD COLUMN "matchKind" "ConversationMatchKind",
  ADD COLUMN "matchReason" TEXT,
  ADD COLUMN "matchCandidateLeadIds" JSONB,
  ADD COLUMN "lastMessageAt" TIMESTAMP(3),
  ADD COLUMN "baselineImportedAt" TIMESTAMP(3);

UPDATE "Conversation"
SET "classification" = 'SPAM'
WHERE "status" = 'SPAM';

ALTER TABLE "Conversation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Conversation"
  ALTER COLUMN "status" TYPE "ConversationStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'SPAM' THEN 'OPEN'
      ELSE "status"::text
    END
  )::"ConversationStatus_new";
DROP TYPE "ConversationStatus";
ALTER TYPE "ConversationStatus_new" RENAME TO "ConversationStatus";
ALTER TABLE "Conversation" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "Message"
  ADD COLUMN "replyTo" TEXT,
  ADD COLUMN "internetMessageId" TEXT,
  ADD COLUMN "inReplyTo" TEXT,
  ADD COLUMN "references" JSONB,
  ADD COLUMN "externalSubmissionId" TEXT,
  ADD COLUMN "sourceSystem" TEXT,
  ALTER COLUMN "bodyText" DROP NOT NULL;

CREATE INDEX "Conversation_ownerId_reviewState_lastMessageAt_idx" ON "Conversation"("ownerId", "reviewState", "lastMessageAt");
CREATE INDEX "Conversation_ownerId_classification_lastMessageAt_idx" ON "Conversation"("ownerId", "classification", "lastMessageAt");
CREATE INDEX "Message_ownerId_externalSubmissionId_idx" ON "Message"("ownerId", "externalSubmissionId");
CREATE UNIQUE INDEX "LeadActivity_messageId_type_key" ON "LeadActivity"("messageId", "type");
