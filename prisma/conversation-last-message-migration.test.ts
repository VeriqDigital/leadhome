import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260727120000_repair_conversation_last_message_at/migration.sql",
  ),
  "utf8",
);

describe("conversation last-message migration", () => {
  it("idempotently backfills each conversation from its newest message", () => {
    expect(migration).toContain('MAX(message."receivedAt")');
    expect(migration).toContain('"lastMessageAt" IS DISTINCT FROM');
  });

  it("maintains greatest-known timestamps for every message insert", () => {
    expect(migration).toContain("AFTER INSERT OR UPDATE OF");
    expect(migration).toContain("GREATEST(");
    expect(migration).toContain('COALESCE("lastMessageAt", NEW."receivedAt")');
  });
});
