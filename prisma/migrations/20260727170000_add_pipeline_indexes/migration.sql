CREATE INDEX "Lead_userId_status_nextFollowUpDate_updatedAt_id_idx"
  ON "Lead"("userId", "status", "nextFollowUpDate", "updatedAt", "id");

CREATE INDEX "Lead_userId_status_updatedAt_id_idx"
  ON "Lead"("userId", "status", "updatedAt", "id");

CREATE INDEX "Lead_userId_status_estimatedValue_id_idx"
  ON "Lead"("userId", "status", "estimatedValue", "id");
