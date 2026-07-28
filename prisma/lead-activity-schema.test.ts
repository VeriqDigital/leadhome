import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("LeadActivity database constraints", () => {
  const original = readFileSync(
      new URL(
        "./migrations/20260723143000_add_lead_activities/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
  const migration = readFileSync(
    new URL(
      "./migrations/20260727230000_unified_activity_timeline/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const provenanceMigration = readFileSync(
    new URL(
      "./migrations/20260727231500_correct_unified_activity_provenance/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );

  it("preserves the original history and owner cascade", () => {
    expect(original).toContain(
      'FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE',
    );
    expect(original).toContain(
      'FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE',
    );
  });

  it("extends the existing model with typed unified activity fields", () => {
    expect(schema).toMatch(/model LeadActivity \{[\s\S]*leadId\s+String\?/);
    for (const field of [
      "taskId",
      "actorType",
      "source",
      "occurredAt",
      "idempotencyKey",
    ]) {
      expect(schema).toMatch(new RegExp(`model LeadActivity \\{[\\s\\S]*\\b${field}\\b`));
    }
    expect(schema).toContain("@@unique([userId, idempotencyKey])");
    expect(schema).toContain("@@index([leadId, occurredAt, id])");
    expect(schema).toContain("@@index([conversationId, occurredAt, id])");
    expect(schema).toContain("@@index([userId, type, occurredAt, id])");
  });

  it("backfills precise timestamps and task links without changing message history", () => {
    expect(migration).toContain('SET "occurredAt" = "createdAt"');
    expect(migration).toContain('SET "occurredAt" = message."receivedAt"');
    expect(migration).toContain(
      `activity."metadata"->>'taskId' = task."id"`,
    );
    expect(migration).toContain("ALTER COLUMN \"leadId\" DROP NOT NULL");
    expect(migration).toContain("ON DELETE SET NULL ON UPDATE CASCADE");
    expect(migration).not.toMatch(/DELETE FROM "LeadActivity"|TRUNCATE/i);
  });

  it("adds stable actor, source, and event enums in one migration", () => {
    expect(migration).toContain('CREATE TYPE "LeadActivityActorType"');
    expect(migration).toContain('CREATE TYPE "LeadActivitySource"');
    for (const type of [
      "CONVERSATION_IMPORTED",
      "CONVERSATION_STATUS_CHANGED",
      "AI_ANALYSIS_COMPLETED",
    ]) {
      expect(migration).toContain(`ADD VALUE '${type}'`);
      expect(schema).toMatch(
        new RegExp(`enum LeadActivityType \\{[\\s\\S]*\\b${type}\\b`),
      );
    }
  });

  it("corrects identifiable legacy Gmail and automatic-link provenance additively", () => {
    expect(provenanceMigration).toContain(
      `conversation."provider" = 'GMAIL'`,
    );
    expect(provenanceMigration).toContain(
      `"metadata"->>'automatic' = 'true'`,
    );
    expect(provenanceMigration).toContain(
      `SET "actorType" = 'SYSTEM'::"LeadActivityActorType"`,
    );
    expect(provenanceMigration).not.toMatch(
      /DELETE FROM "LeadActivity"|TRUNCATE/i,
    );
  });
});
