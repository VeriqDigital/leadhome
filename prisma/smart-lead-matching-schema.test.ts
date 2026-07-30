import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
const migrationName =
  "20260729192000_add_smart_lead_match_dismissals";
const migration = readFileSync(
  join(root, "prisma", "migrations", migrationName, "migration.sql"),
  "utf8",
);

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  expect(match, `${name} model should exist`).not.toBeNull();
  return match![0];
}

describe("Smart Lead Matching dismissal schema and migration", () => {
  it("stores a durable owner-scoped dismissal for one evidence fingerprint", () => {
    const dismissal = modelBlock("ConversationLeadMatchDismissal");

    for (const field of [
      "id",
      "ownerId",
      "conversationId",
      "leadId",
      "evidenceFingerprint",
      "dismissedAt",
    ]) {
      expect(dismissal).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(dismissal).toMatch(/dismissedAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(dismissal).toContain(
      "@@unique([ownerId, conversationId, leadId, evidenceFingerprint]",
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ConversationLeadMatchDismissal_owner_match_fingerprint_key"',
    );
    expect(migration).toContain(
      '"dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
  });

  it("enforces conversation and lead ownership with composite foreign keys", () => {
    const user = modelBlock("User");
    const lead = modelBlock("Lead");
    const conversation = modelBlock("Conversation");
    const dismissal = modelBlock("ConversationLeadMatchDismissal");

    expect(user).toMatch(
      /conversationLeadMatchDismissals\s+ConversationLeadMatchDismissal\[\]/,
    );
    expect(lead).toMatch(
      /conversationLeadMatchDismissals\s+ConversationLeadMatchDismissal\[\]/,
    );
    expect(conversation).toMatch(
      /leadMatchDismissals\s+ConversationLeadMatchDismissal\[\]/,
    );
    expect(lead).toContain("@@unique([id, userId])");
    expect(dismissal).toContain(
      "@relation(fields: [conversationId, ownerId], references: [id, ownerId], onDelete: Cascade",
    );
    expect(dismissal).toContain(
      "@relation(fields: [leadId, ownerId], references: [id, userId], onDelete: Cascade",
    );

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "Lead_id_userId_key"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("conversationId", "ownerId")',
    );
    expect(migration).toContain(
      'REFERENCES "Conversation"("id", "ownerId")',
    );
    expect(migration).toContain('FOREIGN KEY ("leadId", "ownerId")');
    expect(migration).toContain('REFERENCES "Lead"("id", "userId")');
  });

  it("cascades dismissals and provides the lookup indexes", () => {
    expect(
      migration.match(/ON DELETE CASCADE ON UPDATE CASCADE/g),
    ).toHaveLength(3);
    expect(migration).toContain(
      'CREATE INDEX "ConversationLeadMatchDismissal_owner_conversation_dismissed_idx"',
    );
    expect(migration).toContain(
      'CREATE INDEX "ConversationLeadMatchDismissal_owner_lead_idx"',
    );
  });

  it("is an additive migration with one timestamped Smart Lead Matching migration", () => {
    expect(migration).not.toMatch(
      /(?:^|\n)\s*(?:DROP|DELETE|UPDATE|TRUNCATE)\b/i,
    );

    const matching = readdirSync(join(root, "prisma", "migrations")).filter(
      (name) => name.endsWith("_add_smart_lead_match_dismissals"),
    );
    expect(matching).toEqual([migrationName]);
  });
});
