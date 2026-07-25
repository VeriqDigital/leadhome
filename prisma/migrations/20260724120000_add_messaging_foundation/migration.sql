CREATE TYPE "MessageProvider" AS ENUM ('FAKE', 'GMAIL', 'OUTLOOK', 'MICROSOFT_365', 'FACEBOOK_MESSENGER', 'INSTAGRAM', 'SMS', 'WHATSAPP');
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'ARCHIVED', 'SPAM');
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

ALTER TYPE "LeadActivityType" ADD VALUE 'MESSAGE_RECEIVED';
ALTER TYPE "LeadActivityType" ADD VALUE 'MESSAGE_SENT';
ALTER TYPE "LeadActivityType" ADD VALUE 'CONVERSATION_LINKED';
ALTER TYPE "LeadActivityType" ADD VALUE 'CONVERSATION_UNLINKED';

CREATE TABLE "CommunicationAccount" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "provider" "MessageProvider" NOT NULL,
  "displayName" TEXT NOT NULL,
  "address" TEXT,
  "providerAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunicationAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "provider" "MessageProvider" NOT NULL,
  "providerConversationId" TEXT NOT NULL,
  "leadId" TEXT,
  "subject" TEXT,
  "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "direction" "MessageDirection" NOT NULL,
  "sender" TEXT NOT NULL,
  "recipients" JSONB NOT NULL,
  "subject" TEXT,
  "bodyText" TEXT NOT NULL,
  "bodyHtml" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LeadActivity" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "LeadActivity" ADD COLUMN "messageId" TEXT;

CREATE UNIQUE INDEX "CommunicationAccount_ownerId_provider_providerAccountId_key" ON "CommunicationAccount"("ownerId", "provider", "providerAccountId");
CREATE UNIQUE INDEX "CommunicationAccount_id_ownerId_provider_key" ON "CommunicationAccount"("id", "ownerId", "provider");
CREATE INDEX "CommunicationAccount_ownerId_createdAt_idx" ON "CommunicationAccount"("ownerId", "createdAt");
CREATE UNIQUE INDEX "Conversation_accountId_providerConversationId_key" ON "Conversation"("accountId", "providerConversationId");
CREATE UNIQUE INDEX "Conversation_id_ownerId_key" ON "Conversation"("id", "ownerId");
CREATE UNIQUE INDEX "Conversation_id_ownerId_accountId_key" ON "Conversation"("id", "ownerId", "accountId");
CREATE INDEX "Conversation_ownerId_updatedAt_idx" ON "Conversation"("ownerId", "updatedAt");
CREATE INDEX "Conversation_leadId_updatedAt_idx" ON "Conversation"("leadId", "updatedAt");
CREATE UNIQUE INDEX "Message_accountId_providerMessageId_key" ON "Message"("accountId", "providerMessageId");
CREATE INDEX "Message_ownerId_receivedAt_idx" ON "Message"("ownerId", "receivedAt");
CREATE INDEX "LeadActivity_conversationId_createdAt_idx" ON "LeadActivity"("conversationId", "createdAt");
CREATE INDEX "LeadActivity_messageId_createdAt_idx" ON "LeadActivity"("messageId", "createdAt");

ALTER TABLE "CommunicationAccount" ADD CONSTRAINT "CommunicationAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_accountId_ownerId_provider_fkey" FOREIGN KEY ("accountId", "ownerId", "provider") REFERENCES "CommunicationAccount"("id", "ownerId", "provider") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_ownerId_accountId_fkey" FOREIGN KEY ("conversationId", "ownerId", "accountId") REFERENCES "Conversation"("id", "ownerId", "accountId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
