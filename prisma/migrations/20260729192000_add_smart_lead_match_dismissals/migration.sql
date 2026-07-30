-- CreateIndex
-- This composite key lets dismissal rows prove that the referenced lead belongs
-- to the same owner without changing any existing lead data.
CREATE UNIQUE INDEX "Lead_id_userId_key"
ON "Lead"("id", "userId");

-- CreateTable
CREATE TABLE "ConversationLeadMatchDismissal" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "evidenceFingerprint" TEXT NOT NULL,
  "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConversationLeadMatchDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationLeadMatchDismissal_owner_match_fingerprint_key"
ON "ConversationLeadMatchDismissal"(
  "ownerId",
  "conversationId",
  "leadId",
  "evidenceFingerprint"
);

-- CreateIndex
CREATE INDEX "ConversationLeadMatchDismissal_owner_conversation_dismissed_idx"
ON "ConversationLeadMatchDismissal"(
  "ownerId",
  "conversationId",
  "dismissedAt"
);

-- CreateIndex
CREATE INDEX "ConversationLeadMatchDismissal_owner_lead_idx"
ON "ConversationLeadMatchDismissal"("ownerId", "leadId");

-- AddForeignKey
ALTER TABLE "ConversationLeadMatchDismissal"
ADD CONSTRAINT "ConversationLeadMatchDismissal_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLeadMatchDismissal"
ADD CONSTRAINT "ConversationLeadMatchDismissal_conversation_owner_fkey"
FOREIGN KEY ("conversationId", "ownerId")
REFERENCES "Conversation"("id", "ownerId")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLeadMatchDismissal"
ADD CONSTRAINT "ConversationLeadMatchDismissal_lead_owner_fkey"
FOREIGN KEY ("leadId", "ownerId")
REFERENCES "Lead"("id", "userId")
ON DELETE CASCADE ON UPDATE CASCADE;
