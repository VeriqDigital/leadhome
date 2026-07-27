import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    root,
    "prisma",
    "migrations",
    "20260727200000_add_background_jobs",
    "migration.sql",
  ),
  "utf8",
);

describe("background job schema and migration", () => {
  it("defines one owner-scoped generic job model and its lifecycle enums", () => {
    expect(schema).toMatch(/\bjobs\s+Job\[\]/);
    expect(schema).toMatch(/model Job \{[\s\S]*ownerId\s+String/);
    expect(schema).toMatch(/enum JobType \{[\s\S]*GMAIL_SYNC/);
    expect(schema).toMatch(
      /enum JobType \{[\s\S]*CONVERSATION_ANALYSIS/,
    );
    for (const status of [
      "PENDING",
      "RUNNING",
      "RETRY_SCHEDULED",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ]) {
      expect(schema).toMatch(
        new RegExp(`enum JobStatus \\{[\\s\\S]*${status}`),
      );
    }
    expect(schema).not.toMatch(/ownerId\s+String\?/);
  });

  it("enforces active-key idempotency and adds claim, recovery, and history indexes", () => {
    expect(schema).toContain("@@unique([ownerId, type, idempotencyKey])");
    expect(schema).toContain(
      "@@index([status, availableAt, createdAt, id])",
    );
    expect(schema).toContain(
      "@@index([status, heartbeatAt, lockedAt, id])",
    );
    expect(schema).toContain("@@index([ownerId, type, createdAt, id])");

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "Job_ownerId_type_idempotencyKey_key"',
    );
    expect(migration).toContain(
      'CREATE INDEX "Job_status_availableAt_createdAt_id_idx"',
    );
    expect(migration).toContain(
      'CREATE INDEX "Job_status_heartbeatAt_lockedAt_id_idx"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("ownerId") REFERENCES "User"("id")',
    );
  });

  it("stores structured JSON without adding provider credentials", () => {
    expect(migration).toContain('"payload" JSONB NOT NULL');
    expect(migration).toContain('"progress" JSONB');
    expect(migration).toContain('"result" JSONB');
    expect(migration).not.toMatch(
      /access.?token|refresh.?token|authorization.?code|message.?body/i,
    );
  });
});
