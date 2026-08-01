import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { safeTaskListReturnPath } from "./task-return-path";

describe("task edit navigation and lifecycle controls", () => {
  it("accepts only local task-list return paths", () => {
    expect(safeTaskListReturnPath("/tasks?view=all&page=2")).toBe(
      "/tasks?view=all&page=2",
    );
    expect(safeTaskListReturnPath("/tasks/other?view=all")).toBe("/tasks");
    expect(safeTaskListReturnPath("https://example.com/tasks?view=all"))
      .toBe("/tasks");
    expect(safeTaskListReturnPath("//example.com/tasks")).toBe("/tasks");
  });

  it("carries the current list filters into Edit and back navigation", () => {
    const list = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const edit = readFileSync(
      new URL("./[id]/edit/page.tsx", import.meta.url),
      "utf8",
    );
    expect(list).toContain("const currentHref = href(page)");
    expect(list).toContain("returnTo=${encodeURIComponent(currentHref)}");
    expect(edit).toContain("safeTaskListReturnPath");
    expect(edit).toContain("href={returnTo}");
  });

  it("uses status-aware lifecycle controls on the edit screen", () => {
    const edit = readFileSync(
      new URL("./[id]/edit/page.tsx", import.meta.url),
      "utf8",
    );
    const controls = readFileSync(
      new URL("./task-lifecycle-actions.tsx", import.meta.url),
      "utf8",
    );
    expect(edit).toContain("<TaskLifecycleActions");
    expect(controls).toContain('status === "OPEN"');
    expect(controls).toContain("Complete");
    expect(controls).toContain("Cancel");
    expect(controls).toContain("Reopen");
    expect(controls).toContain("Delete");
  });
});
