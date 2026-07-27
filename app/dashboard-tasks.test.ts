import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");

describe("dashboard task data", () => {
  it("uses bounded owner-scoped real task queries without fixtures", () => {
    expect(source).not.toContain("demoTasks");
    expect(source).not.toContain("demoReminders");
    expect(source).not.toContain("Sarah Jones");
    expect(source).toContain("ownerId: user.id");
    expect(source.match(/take: 5/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("renders overdue, due-today, upcoming, and direct completion workflows", () => {
    expect(source).toContain('title="Overdue Tasks"');
    expect(source).toContain('title="Due Today"');
    expect(source).toContain('title="Upcoming Tasks"');
    expect(source).toContain("completeTaskAction");
  });
});
