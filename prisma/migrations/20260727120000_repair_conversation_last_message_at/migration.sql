-- Repair conversations created before lastMessageAt was maintained.
-- IS DISTINCT FROM makes this safe to rerun and also repairs stale non-null values.
UPDATE "Conversation" AS conversation
SET "lastMessageAt" = (
  SELECT MAX(message."receivedAt")
  FROM "Message" AS message
  WHERE message."conversationId" = conversation.id
)
WHERE conversation."lastMessageAt" IS DISTINCT FROM (
  SELECT MAX(message."receivedAt")
  FROM "Message" AS message
  WHERE message."conversationId" = conversation.id
);

-- Keep the denormalized timestamp correct for every current and future message
-- writer. GREATEST prevents retries and out-of-order imports from moving it back.
CREATE OR REPLACE FUNCTION update_conversation_last_message_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "Conversation"
  SET "lastMessageAt" = GREATEST(
    COALESCE("lastMessageAt", NEW."receivedAt"),
    NEW."receivedAt"
  )
  WHERE id = NEW."conversationId";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Message_maintain_conversation_last_message_at"
AFTER INSERT OR UPDATE OF "receivedAt" ON "Message"
FOR EACH ROW
EXECUTE FUNCTION update_conversation_last_message_at();
