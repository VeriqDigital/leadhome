CREATE TYPE "TaskType" AS ENUM ('GENERAL', 'CALL', 'EMAIL', 'MEETING', 'FOLLOW_UP');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

ALTER TYPE "LeadActivityType" ADD VALUE 'TASK_CREATED';
ALTER TYPE "LeadActivityType" ADD VALUE 'TASK_UPDATED';
ALTER TYPE "LeadActivityType" ADD VALUE 'TASK_COMPLETED';
ALTER TYPE "LeadActivityType" ADD VALUE 'TASK_REOPENED';
ALTER TYPE "LeadActivityType" ADD VALUE 'TASK_CANCELLED';
ALTER TYPE "LeadActivityType" ADD VALUE 'TASK_DELETED';

CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "leadId" TEXT,
  "conversationId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" "TaskType" NOT NULL DEFAULT 'GENERAL',
  "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Task_ownerId_status_dueAt_id_idx"
  ON "Task"("ownerId", "status", "dueAt", "id");

CREATE INDEX "Task_ownerId_type_dueAt_idx"
  ON "Task"("ownerId", "type", "dueAt");

CREATE INDEX "Task_leadId_status_dueAt_idx"
  ON "Task"("leadId", "status", "dueAt");

CREATE INDEX "Task_conversationId_status_dueAt_idx"
  ON "Task"("conversationId", "status", "dueAt");
