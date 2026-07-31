-- AlterEnum
-- This migration has not been deployed yet, so the Phase 2 company worker is
-- added here rather than by modifying an older, already-applied migration.
ALTER TYPE "JobType" ADD VALUE 'COMPANY_DETECTION';

-- CreateTable
-- Company suggestions remain derived from current owner-scoped evidence. This
-- table stores only an evidence-specific review decision so a materially
-- changed candidate can be considered later.
CREATE TABLE "ConversationCompanySuggestionDismissal" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "candidateValue" TEXT NOT NULL,
  "evidenceSource" TEXT NOT NULL,
  "evidenceFingerprint" TEXT NOT NULL,
  "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConversationCompanySuggestionDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanySuggestionDismissal_owner_candidate_fingerprint_key"
ON "ConversationCompanySuggestionDismissal"(
  "ownerId",
  "conversationId",
  "leadId",
  "evidenceFingerprint"
);

-- CreateIndex
CREATE INDEX "CompanySuggestionDismissal_owner_conversation_lead_idx"
ON "ConversationCompanySuggestionDismissal"(
  "ownerId",
  "conversationId",
  "leadId",
  "dismissedAt"
);

-- CreateIndex
CREATE INDEX "CompanySuggestionDismissal_owner_lead_idx"
ON "ConversationCompanySuggestionDismissal"("ownerId", "leadId");

-- AddForeignKey
ALTER TABLE "ConversationCompanySuggestionDismissal"
ADD CONSTRAINT "ConversationCompanySuggestionDismissal_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationCompanySuggestionDismissal"
ADD CONSTRAINT "ConversationCompanySuggestionDismissal_conversation_owner_fkey"
FOREIGN KEY ("conversationId", "ownerId")
REFERENCES "Conversation"("id", "ownerId")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationCompanySuggestionDismissal"
ADD CONSTRAINT "ConversationCompanySuggestionDismissal_lead_owner_fkey"
FOREIGN KEY ("leadId", "ownerId")
REFERENCES "Lead"("id", "userId")
ON DELETE CASCADE ON UPDATE CASCADE;
