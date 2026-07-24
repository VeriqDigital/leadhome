import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LeadActivity database constraints", () => {
  it("cascades activity deletion from leads and users", () => {
    const migration = readFileSync(
      new URL(
        "./migrations/20260723143000_add_lead_activities/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain(
      'FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE',
    );
  });
});
