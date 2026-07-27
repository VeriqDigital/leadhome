-- The combined Inbox controls path historically recorded attachment activity
-- without advancing Lead.updatedAt. Repair those leads from the durable activity
-- timestamp while preserving any later lead update.
UPDATE "Lead" AS lead
SET "updatedAt" = latest."createdAt"
FROM (
  SELECT "leadId", MAX("createdAt") AS "createdAt"
  FROM "LeadActivity"
  WHERE type = 'CONVERSATION_LINKED'
  GROUP BY "leadId"
) AS latest
WHERE lead.id = latest."leadId"
  AND lead."updatedAt" < latest."createdAt";
