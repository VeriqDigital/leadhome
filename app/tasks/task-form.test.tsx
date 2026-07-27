import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  shouldShowTaskMessage,
  taskFieldResetKey,
} from "./task-form";

describe("task creation form reset behavior", () => {
  it("remounts creation fields for every successful task ID but preserves edit fields", () => {
    const success = {
      success: true,
      changed: true,
      message: "Task created.",
      taskId: "task-new",
    };
    expect(taskFieldResetKey(success, "Create task")).toBe("task-new");
    expect(taskFieldResetKey(success, "Save task")).toBeUndefined();
  });

  it("clears a prior success message when the user starts the next task", () => {
    const success = {
      success: true,
      message: "Task created.",
      taskId: "task-new",
    };
    expect(shouldShowTaskMessage(success)).toBe(true);
    expect(shouldShowTaskMessage(success, "task-new")).toBe(false);
  });

  it("constrains long conversation selections to the form grid", () => {
    const source = readFileSync(new URL("./task-form.tsx", import.meta.url), "utf8");
    expect(source).toContain("max-w-full");
    expect(source).toContain("w-full min-w-0");
    expect(source).toContain('className="grid min-w-0 gap-4 sm:grid-cols-2"');
  });

  it("renders task actions with disabled processing labels", () => {
    const source = readFileSync(
      new URL("./task-action-button.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("useFormStatus");
    expect(source).toContain("disabled={pending}");
    expect(source).toContain("pending ? pendingLabel : label");
  });
});
