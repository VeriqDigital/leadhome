-- Correct legacy provenance where the related records retain enough canonical
-- information to distinguish Gmail imports and automatic lead matching. This
-- is intentionally a follow-up migration: the unified activity migration was
-- already applied and must remain immutable.
UPDATE "LeadActivity" AS activity
SET "source" = 'GMAIL'::"LeadActivitySource"
FROM "Message" AS message
JOIN "Conversation" AS conversation
  ON conversation."id" = message."conversationId"
WHERE activity."messageId" = message."id"
  AND activity."userId" = message."ownerId"
  AND conversation."ownerId" = activity."userId"
  AND conversation."provider" = 'GMAIL'
  AND activity."type" IN ('MESSAGE_RECEIVED', 'MESSAGE_SENT');

UPDATE "LeadActivity"
SET "actorType" = 'SYSTEM'::"LeadActivityActorType"
WHERE "type" = 'CONVERSATION_LINKED'
  AND "metadata"->>'automatic' = 'true';

UPDATE "LeadActivity" AS activity
SET "source" = CASE
  WHEN conversation."provider" = 'GMAIL'
    THEN 'GMAIL'::"LeadActivitySource"
  ELSE 'SYSTEM'::"LeadActivitySource"
END
FROM "Conversation" AS conversation
WHERE activity."conversationId" = conversation."id"
  AND activity."userId" = conversation."ownerId"
  AND activity."type" = 'CONVERSATION_LINKED'
  AND activity."metadata"->>'automatic' = 'true';
