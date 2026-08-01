import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");

describe("dashboard information architecture", () => {
  it("uses the centralized attention service without dashboard fixture data", () => {
    expect(source).not.toContain("demoTasks");
    expect(source).not.toContain("demoReminders");
    expect(source).not.toContain("Sarah Jones");
    expect(source).toContain("getDashboardAttention(ownerId, now)");
  });

  it("places action sections before secondary Business Health", () => {
    expect(source.indexOf("<NeedsAttention")).toBeLessThan(
      source.indexOf("<BusinessHealth"),
    );
    expect(source.indexOf("<TodaysWork")).toBeLessThan(
      source.indexOf("<BusinessHealth"),
    );
    expect(source).toContain("Business health");
    expect(source).toContain("getDashboardRecentActivities(ownerId, 5)");
  });

  it("removes redundant recent-lead and task-card dashboard widgets", () => {
    expect(source).not.toContain("RecentLeads");
    expect(source).not.toContain('title="Overdue Tasks"');
    expect(source).not.toContain('title="Due Today"');
    expect(source).not.toContain('title="Upcoming Tasks"');
  });
});
