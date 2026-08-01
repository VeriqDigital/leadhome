-- Support bounded latest-message lookups for owner-scoped attention queues
-- and existing conversation detail ordering without changing message history.
CREATE INDEX "Message_conversationId_receivedAt_id_idx"
ON "Message"("conversationId", "receivedAt", "id");
