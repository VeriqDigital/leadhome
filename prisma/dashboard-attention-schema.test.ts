import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("dashboard attention query support", () => {
  it("adds one immutable index for latest-message conversation lookups", () => {
    const schema = readFileSync(
      join(process.cwd(), "prisma/schema.prisma"),
      "utf8",
    );
    const migration = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260731210000_add_message_conversation_time_index/migration.sql",
      ),
      "utf8",
    );

    expect(schema).toContain("@@index([conversationId, receivedAt, id])");
    expect(migration).toContain(
      'CREATE INDEX "Message_conversationId_receivedAt_id_idx"',
    );
    expect(migration).not.toMatch(/DELETE|UPDATE|ALTER\s+COLUMN/i);
  });
});
