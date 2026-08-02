import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
const migrationName =
  "20260801120000_add_contact_suggestion_dismissals";
const migration = readFileSync(
  join(root, "prisma", "migrations", migrationName, "migration.sql"),
  "utf8",
);

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  expect(match, `${name} model should exist`).not.toBeNull();
  return match![0];
}

describe("Reviewed Contact Extraction dismissal schema and migration", () => {
  it("defines exactly the supported contact suggestion fields", () => {
    expect(schema).toMatch(
      /enum ContactSuggestionField \{\s+NAME\s+EMAIL\s+PHONE\s+\}/,
    );
    expect(migration).toContain(
      `CREATE TYPE "ContactSuggestionField" AS ENUM ('NAME', 'EMAIL', 'PHONE')`,
    );
  });

  it("stores one candidate- and evidence-specific owner decision", () => {
    const dismissal = modelBlock(
      "ConversationContactSuggestionDismissal",
    );
    for (const field of [
      "id",
      "ownerId",
      "conversationId",
      "leadId",
      "field",
      "candidateHash",
      "evidenceFingerprint",
      "dismissedAt",
    ]) {
      expect(dismissal).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(dismissal).toContain(
      "@@unique([ownerId, conversationId, leadId, field, candidateHash, evidenceFingerprint]",
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ContactSuggestionDismissal_owner_field_candidate_evidence_key"',
    );
    expect(migration).not.toContain('"candidateValue"');
  });

  it("enforces owner-composite conversation and lead relationships", () => {
    const user = modelBlock("User");
    const lead = modelBlock("Lead");
    const conversation = modelBlock("Conversation");
    const dismissal = modelBlock(
      "ConversationContactSuggestionDismissal",
    );

    expect(user).toMatch(
      /contactSuggestionDismissals\s+ConversationContactSuggestionDismissal\[\]/,
    );
    expect(lead).toMatch(
      /contactSuggestionDismissals\s+ConversationContactSuggestionDismissal\[\]/,
    );
    expect(conversation).toMatch(
      /contactSuggestionDismissals\s+ConversationContactSuggestionDismissal\[\]/,
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
    expect(migration).toContain(
      'REFERENCES "Conversation"("id", "ownerId")',
    );
    expect(migration).toContain('FOREIGN KEY ("leadId", "ownerId")');
    expect(migration).toContain('REFERENCES "Lead"("id", "userId")');
  });

  it("cascades owner, conversation, and lead deletion and adds bounded lookup indexes", () => {
    expect(
      migration.match(/ON DELETE CASCADE ON UPDATE CASCADE/g),
    ).toHaveLength(3);
    expect(schema).toContain(
      '@@index([ownerId, conversationId, leadId, dismissedAt], map: "ContactSuggestionDismissal_owner_conversation_lead_idx")',
    );
    expect(schema).toContain(
      '@@index([ownerId, leadId], map: "ContactSuggestionDismissal_owner_lead_idx")',
    );
    expect(migration).toContain(
      'CREATE INDEX "ContactSuggestionDismissal_owner_conversation_lead_idx"',
    );
    expect(migration).toContain(
      'CREATE INDEX "ContactSuggestionDismissal_owner_lead_idx"',
    );
  });

  it("is one additive migration after the current schema history", () => {
    expect(migration).not.toMatch(
      /(?:^|\n)\s*(?:DROP|DELETE|UPDATE|TRUNCATE)\b/i,
    );
    const matching = readdirSync(join(root, "prisma", "migrations")).filter(
      (name) => name.endsWith("_add_contact_suggestion_dismissals"),
    );
    expect(matching).toEqual([migrationName]);
    expect(migrationName.localeCompare("20260731210000")).toBeGreaterThan(0);
  });
});
