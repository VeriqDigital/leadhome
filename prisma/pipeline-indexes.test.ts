import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260727170000_add_pipeline_indexes/migration.sql",
  "utf8",
);

describe("pipeline query indexes", () => {
  it("keeps the schema and additive migration aligned", () => {
    expect(schema).toContain(
      "@@index([userId, status, nextFollowUpDate, updatedAt, id])",
    );
    expect(schema).toContain(
      "@@index([userId, status, estimatedValue, id])",
    );
    expect(migration).toContain(
      '"Lead_userId_status_nextFollowUpDate_updatedAt_id_idx"',
    );
    expect(migration).toContain(
      '"Lead_userId_status_estimatedValue_id_idx"',
    );
    expect(migration).not.toMatch(/\b(?:DROP|DELETE|UPDATE)\b/i);
  });
});
