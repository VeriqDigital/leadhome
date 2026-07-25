import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Phase 2 message import migration", () => {
  const migration = readFileSync(
    new URL(
      "./migrations/20260725120000_add_message_import_pipeline/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  it("separates lifecycle state from classification and review", () => {
    expect(migration).toContain(
      "CREATE TYPE \"ConversationClassification\"",
    );
    expect(migration).toContain(
      "CREATE TYPE \"ConversationReviewState\"",
    );
    expect(migration).toContain(
      "WHEN \"status\"::text = 'SPAM' THEN 'OPEN'",
    );
  });

  it("adds matching indexes and activity idempotency", () => {
    expect(migration).toContain(
      'ON "Conversation"("ownerId", "reviewState", "lastMessageAt")',
    );
    expect(migration).toContain(
      'ON "Message"("ownerId", "externalSubmissionId")',
    );
    expect(migration).toContain(
      'UNIQUE INDEX "LeadActivity_messageId_type_key"',
    );
  });
});
