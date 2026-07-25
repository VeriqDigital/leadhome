import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("messaging database constraints", () => {
  const migration = readFileSync(
    new URL(
      "./migrations/20260724120000_add_messaging_foundation/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  it("prevents duplicate provider conversations and messages in their scope", () => {
    expect(migration).toContain(
      'ON "Conversation"("accountId", "providerConversationId")',
    );
    expect(migration).toContain(
      'ON "Message"("accountId", "providerMessageId")',
    );
  });

  it("cascades account and conversation data while retaining timeline history", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("accountId", "ownerId", "provider") REFERENCES "CommunicationAccount"("id", "ownerId", "provider") ON DELETE CASCADE',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("conversationId", "ownerId", "accountId") REFERENCES "Conversation"("id", "ownerId", "accountId") ON DELETE CASCADE',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL',
    );
  });
});
