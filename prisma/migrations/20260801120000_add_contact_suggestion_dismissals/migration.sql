-- CreateEnum
CREATE TYPE "ContactSuggestionField" AS ENUM ('NAME', 'EMAIL', 'PHONE');

-- CreateTable
-- Contact suggestions remain derived from bounded canonical conversation
-- evidence. This table stores only an evidence-specific review decision and
-- hashes the candidate rather than duplicating contact data.
CREATE TABLE "ConversationContactSuggestionDismissal" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "field" "ContactSuggestionField" NOT NULL,
  "candidateHash" TEXT NOT NULL,
  "evidenceFingerprint" TEXT NOT NULL,
  "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConversationContactSuggestionDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactSuggestionDismissal_owner_field_candidate_evidence_key"
ON "ConversationContactSuggestionDismissal"(
  "ownerId",
  "conversationId",
  "leadId",
  "field",
  "candidateHash",
  "evidenceFingerprint"
);

-- CreateIndex
CREATE INDEX "ContactSuggestionDismissal_owner_conversation_lead_idx"
ON "ConversationContactSuggestionDismissal"(
  "ownerId",
  "conversationId",
  "leadId",
  "dismissedAt"
);

-- CreateIndex
CREATE INDEX "ContactSuggestionDismissal_owner_lead_idx"
ON "ConversationContactSuggestionDismissal"("ownerId", "leadId");

-- AddForeignKey
ALTER TABLE "ConversationContactSuggestionDismissal"
ADD CONSTRAINT "ContactSuggestionDismissal_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationContactSuggestionDismissal"
ADD CONSTRAINT "ContactSuggestionDismissal_conversation_owner_fkey"
FOREIGN KEY ("conversationId", "ownerId")
REFERENCES "Conversation"("id", "ownerId")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationContactSuggestionDismissal"
ADD CONSTRAINT "ContactSuggestionDismissal_lead_owner_fkey"
FOREIGN KEY ("leadId", "ownerId")
REFERENCES "Lead"("id", "userId")
ON DELETE CASCADE ON UPDATE CASCADE;
