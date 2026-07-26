CREATE INDEX "Conversation_ownerId_status_lastMessageAt_id_idx"
  ON "Conversation"("ownerId", "status", "lastMessageAt", "id");
CREATE INDEX "Conversation_ownerId_provider_lastMessageAt_id_idx"
  ON "Conversation"("ownerId", "provider", "lastMessageAt", "id");
