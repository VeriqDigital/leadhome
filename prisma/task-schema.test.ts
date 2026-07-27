import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260727150000_add_tasks/migration.sql"),
  "utf8",
);
const backfill = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260727153000_backfill_legacy_follow_up_tasks/migration.sql",
  ),
  "utf8",
);

describe("task persistence schema", () => {
  it("preserves optional relationships and indexes owner/status/due queries", () => {
    expect(schema).toContain("lead           Lead?");
    expect(schema).toContain("conversation   Conversation?");
    expect(schema).toContain("@@index([ownerId, status, dueAt, id])");
    expect(migration).toContain("ON DELETE SET NULL");
  });

  it("defines canonical task and activity enums in a new migration", () => {
    expect(migration).toContain('CREATE TYPE "TaskType"');
    expect(migration).toContain("'TASK_COMPLETED'");
  });

  it("idempotently preserves legacy follow-up dates as canonical tasks", () => {
    expect(backfill).toContain("'legacy-follow-up-' || lead.id");
    expect(backfill).toContain('WHERE lead."nextFollowUpDate" IS NOT NULL');
    expect(backfill).toContain("NOT EXISTS");
    expect(backfill).toContain("'FOLLOW_UP'");
  });
});
