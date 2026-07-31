import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
const migrationName =
  "20260729210000_add_company_suggestion_dismissals";
const migration = readFileSync(
  join(root, "prisma", "migrations", migrationName, "migration.sql"),
  "utf8",
);

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  expect(match, `${name} model should exist`).not.toBeNull();
  return match![0];
}

describe("Automatic Company Detection dismissal schema and migration", () => {
  it("adds the durable company detection job type in the unapplied milestone migration", () => {
    expect(schema).toMatch(
      /enum JobType \{[\s\S]*COMPANY_DETECTION[\s\S]*\}/,
    );
    expect(migration).toContain(
      `ALTER TYPE "JobType" ADD VALUE 'COMPANY_DETECTION'`,
    );
  });

  it("stores one owner-scoped candidate decision for an evidence fingerprint", () => {
    const dismissal = modelBlock(
      "ConversationCompanySuggestionDismissal",
    );
    for (const field of [
      "ownerId",
      "conversationId",
      "leadId",
      "candidateValue",
      "evidenceSource",
      "evidenceFingerprint",
      "dismissedAt",
    ]) {
      expect(dismissal).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(dismissal).toContain(
      "@@unique([ownerId, conversationId, leadId, evidenceFingerprint]",
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "CompanySuggestionDismissal_owner_candidate_fingerprint_key"',
    );
    expect(dismissal).toContain(
      "@@index([ownerId, leadId]",
    );
    expect(migration).toContain(
      'CREATE INDEX "CompanySuggestionDismissal_owner_lead_idx"',
    );
  });

  it("enforces owner-composite conversation and lead relationships", () => {
    const user = modelBlock("User");
    const lead = modelBlock("Lead");
    const conversation = modelBlock("Conversation");
    const dismissal = modelBlock(
      "ConversationCompanySuggestionDismissal",
    );
    expect(user).toMatch(
      /companySuggestionDismissals\s+ConversationCompanySuggestionDismissal\[\]/,
    );
    expect(lead).toMatch(
      /companySuggestionDismissals\s+ConversationCompanySuggestionDismissal\[\]/,
    );
    expect(conversation).toMatch(
      /companySuggestionDismissals\s+ConversationCompanySuggestionDismissal\[\]/,
    );
    expect(dismissal).toContain(
      "@relation(fields: [conversationId, ownerId], references: [id, ownerId], onDelete: Cascade",
    );
    expect(dismissal).toContain(
      "@relation(fields: [leadId, ownerId], references: [id, userId], onDelete: Cascade",
    );
    expect(migration).toContain(
      'FOREIGN KEY ("conversationId", "ownerId")',
    );
    expect(migration).toContain('FOREIGN KEY ("leadId", "ownerId")');
  });

  it("is additive and does not rewrite company or message history", () => {
    expect(migration).not.toMatch(
      /(?:^|\n)\s*(?:DROP|DELETE|UPDATE|TRUNCATE)\b/i,
    );
    const matching = readdirSync(join(root, "prisma", "migrations")).filter(
      (name) => name.endsWith("_add_company_suggestion_dismissals"),
    );
    expect(matching).toEqual([migrationName]);
  });
});
