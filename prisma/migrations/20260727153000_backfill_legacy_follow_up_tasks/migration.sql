-- Preserve legacy Lead.nextFollowUpDate values by converting them into the
-- canonical open FOLLOW_UP task. Deterministic IDs make this safe to rerun.
WITH inserted AS (
  INSERT INTO "Task" (
    "id",
    "ownerId",
    "leadId",
    "title",
    "description",
    "type",
    "priority",
    "status",
    "dueAt",
    "completedAt",
    "createdAt",
    "updatedAt"
  )
  SELECT
    'legacy-follow-up-' || lead.id,
    lead."userId",
    lead.id,
    'Follow up with ' || lead.name,
    NULL,
    'FOLLOW_UP',
    'NORMAL',
    'OPEN',
    lead."nextFollowUpDate",
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM "Lead" AS lead
  WHERE lead."nextFollowUpDate" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "Task" AS task
      WHERE task.id = 'legacy-follow-up-' || lead.id
    )
  RETURNING id, "ownerId", "leadId", title, type, "dueAt"
)
INSERT INTO "LeadActivity" (
  "id",
  "leadId",
  "userId",
  "type",
  "title",
  "description",
  "metadata",
  "createdAt"
)
SELECT
  'legacy-follow-up-activity-' || inserted."leadId",
  inserted."leadId",
  inserted."ownerId",
  'TASK_CREATED',
  'Follow-up task created',
  inserted.title,
  jsonb_build_object(
    'taskId', inserted.id,
    'taskTitle', inserted.title,
    'taskType', inserted.type,
    'dueAt', inserted."dueAt"
  ),
  CURRENT_TIMESTAMP
FROM inserted;
