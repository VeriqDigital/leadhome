import { describe, expect, it } from "vitest";
import { taskIdSchema, taskInputSchema } from "./task-validation";

const base = {
  title: " Call customer ",
  description: "",
  type: "CALL",
  priority: "HIGH",
  status: "OPEN",
  leadId: "",
  conversationId: "",
};

describe("task validation", () => {
  it("normalizes whitespace and blank optional values", () => {
    expect(taskInputSchema.parse({ ...base, dueAt: "" })).toEqual({
      title: "Call customer",
      description: null,
      type: "CALL",
      priority: "HIGH",
      status: "OPEN",
      dueAt: null,
      leadId: null,
      conversationId: null,
    });
  });

  it("parses date-only and offset date-time values without accepting malformed dates", () => {
    expect(
      taskInputSchema.parse({ ...base, dueAt: "2026-08-02" }).dueAt,
    ).toBeInstanceOf(Date);
    expect(
      taskInputSchema.parse({
        ...base,
        dueAt: "2026-08-02T15:30:00.000-05:00",
      }).dueAt?.toISOString(),
    ).toBe("2026-08-02T20:30:00.000Z");
    expect(
      taskInputSchema.safeParse({ ...base, dueAt: "not-a-date" }).success,
    ).toBe(false);
  });

  it("accepts app CUIDs and the narrow deterministic legacy follow-up format", () => {
    expect(taskIdSchema.safeParse("cms39vjfa0001j99o60s0e52j").success).toBe(true);
    expect(
      taskIdSchema.safeParse(
        "legacy-follow-up-cmryaj3vu000nl204zwq591w3",
      ).success,
    ).toBe(true);
    expect(taskIdSchema.safeParse("legacy-follow-up-anything").success).toBe(false);
  });
});
