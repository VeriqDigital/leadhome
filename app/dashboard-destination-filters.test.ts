import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("dashboard attention destination filters", () => {
  it("renders bookmarkable Inbox attention filters and explains active state", () => {
    const source = readFileSync(
      join(process.cwd(), "app/inbox/page.tsx"),
      "utf8",
    );
    expect(source).toContain('name="attention"');
    expect(source).toContain("inboxAttentionValues");
    expect(source).toContain("Showing attention queue:");
    expect(source).toContain("classified Lead or Customer qualify");
    expect(source).toContain("parseInboxAttention(one(params.attention))");
  });

  it("preserves and explains the untouched Leads filter", () => {
    const source = readFileSync(
      join(process.cwd(), "app/leads/page.tsx"),
      "utf8",
    );
    expect(source).toContain('name="attention"');
    expect(source).toContain('label: "Needs contact"');
    expect(source).toContain('label: "All contact states"');
    expect(source).toContain('query.set("attention", attention)');
    expect(source).toContain(
      "Showing new leads with no recorded outbound contact.",
    );
  });

  it("reuses the canonical overdue Tasks view", () => {
    const dashboard = readFileSync(
      join(process.cwd(), "lib/dashboard/attention.ts"),
      "utf8",
    );
    const tasks = readFileSync(
      join(process.cwd(), "app/tasks/page.tsx"),
      "utf8",
    );
    expect(dashboard).toContain('href: "/tasks?view=overdue"');
    expect(tasks).toContain('"overdue"');
    expect(tasks).toContain(
      "Showing open tasks that are past their due time.",
    );
  });
});
