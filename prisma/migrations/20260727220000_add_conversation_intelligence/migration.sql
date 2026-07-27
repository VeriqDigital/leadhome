-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'CONVERSATION_ANALYSIS';

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "conversationIntelligenceEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "ConversationAnalysisStatus" AS ENUM (
  'NOT_ANALYZED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'SKIPPED'
);

-- CreateTable
CREATE TABLE "ConversationAnalysis" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "latestJobId" TEXT,
  "status" "ConversationAnalysisStatus" NOT NULL DEFAULT 'NOT_ANALYZED',
  "contentHash" TEXT,
  "analysisVersion" TEXT NOT NULL,
  "summary" TEXT,
  "structuredData" JSONB,
  "model" TEXT,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "totalTokens" INTEGER,
  "durationMs" INTEGER,
  "sourceMessageCount" INTEGER NOT NULL DEFAULT 0,
  "inputTruncated" BOOLEAN NOT NULL DEFAULT false,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "queuedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ConversationAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAnalysis_conversationId_ownerId_key"
ON "ConversationAnalysis"("conversationId", "ownerId");

-- CreateIndex
CREATE INDEX "ConversationAnalysis_ownerId_status_updatedAt_idx"
ON "ConversationAnalysis"("ownerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ConversationAnalysis_ownerId_completedAt_idx"
ON "ConversationAnalysis"("ownerId", "completedAt");

-- CreateIndex
CREATE INDEX "ConversationAnalysis_latestJobId_idx"
ON "ConversationAnalysis"("latestJobId");

-- AddForeignKey
ALTER TABLE "ConversationAnalysis"
ADD CONSTRAINT "ConversationAnalysis_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationAnalysis"
ADD CONSTRAINT "ConversationAnalysis_conversationId_ownerId_fkey"
FOREIGN KEY ("conversationId", "ownerId")
REFERENCES "Conversation"("id", "ownerId")
ON DELETE CASCADE ON UPDATE CASCADE;
