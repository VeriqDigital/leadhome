import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
const migrationName =
  "20260727220000_add_conversation_intelligence";
const migration = readFileSync(
  join(root, "prisma", "migrations", migrationName, "migration.sql"),
  "utf8",
);

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  expect(match, `${name} model should exist`).not.toBeNull();
  return match![0];
}

describe("Conversation Intelligence schema and migration", () => {
  it("adds one explicitly disabled owner preference without backfill work", () => {
    expect(schema).toMatch(
      /conversationIntelligenceEnabled\s+Boolean\s+@default\(false\)/,
    );
    expect(migration).toContain(
      'ADD COLUMN "conversationIntelligenceEnabled" BOOLEAN NOT NULL DEFAULT false',
    );
    expect(migration).not.toMatch(
      /INSERT INTO "Job"|UPDATE "Conversation" SET/i,
    );
  });

  it("defines one owner-scoped canonical analysis with cascading conversation ownership", () => {
    const analysis = modelBlock("ConversationAnalysis");
    expect(analysis).toMatch(/ownerId\s+String/);
    expect(analysis).toMatch(/conversationId\s+String/);
    expect(analysis).toContain(
      "@relation(fields: [conversationId, ownerId], references: [id, ownerId], onDelete: Cascade)",
    );
    expect(analysis).toContain("@@unique([conversationId, ownerId])");
    expect(analysis).toContain("@@index([latestJobId])");

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ConversationAnalysis_conversationId_ownerId_key"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("conversationId", "ownerId")',
    );
    expect(migration).toContain(
      'REFERENCES "Conversation"("id", "ownerId")',
    );
    expect(migration).toContain("ON DELETE CASCADE ON UPDATE CASCADE");
  });

  it("stores canonical structured output, safe errors, and usage metadata separately from jobs", () => {
    const analysis = modelBlock("ConversationAnalysis");
    for (const field of [
      "contentHash",
      "analysisVersion",
      "summary",
      "structuredData",
      "model",
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "durationMs",
      "sourceMessageCount",
      "inputTruncated",
      "lastErrorCode",
      "lastErrorMessage",
      "queuedAt",
      "startedAt",
      "completedAt",
    ]) {
      expect(analysis).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(analysis).not.toMatch(
      /apiKey|oauth|accessToken|refreshToken|messageBody|rawPrompt|rawResponse/i,
    );
    expect(migration).not.toContain(
      'FOREIGN KEY ("latestJobId") REFERENCES "Job"',
    );
  });

  it("extends the generic job enum and defines the complete analysis lifecycle", () => {
    expect(schema).toMatch(
      /enum JobType \{[\s\S]*GMAIL_SYNC[\s\S]*CONVERSATION_ANALYSIS[\s\S]*\}/,
    );
    expect(migration).toContain(
      `ALTER TYPE "JobType" ADD VALUE 'CONVERSATION_ANALYSIS'`,
    );
    for (const status of [
      "NOT_ANALYZED",
      "QUEUED",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "SKIPPED",
    ]) {
      expect(schema).toMatch(
        new RegExp(
          `enum ConversationAnalysisStatus \\{[\\s\\S]*\\b${status}\\b`,
        ),
      );
      expect(migration).toContain(`'${status}'`);
    }
  });

  it("uses exactly one named Conversation Intelligence migration", () => {
    const matching = readdirSync(join(root, "prisma", "migrations"))
      .filter((name) => name.endsWith("_add_conversation_intelligence"));
    expect(matching).toEqual([migrationName]);
  });
});
