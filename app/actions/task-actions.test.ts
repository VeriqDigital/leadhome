import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  cancelTask: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock("@/lib/auth-user", () => ({
  requireUser: vi.fn(async () => ({ id: "owner-a" })),
}));
vi.mock("@/lib/tasks/task-service", () => services);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  cancelTaskAction,
  completeTaskAction,
  deleteTaskAction,
} from "./task-actions";

const legacyId = "legacy-follow-up-cmryaj3vu000nl204zwq591w3";

beforeEach(() => {
  vi.clearAllMocks();
  const result = {
    kind: "changed",
    task: { id: legacyId, lead: null },
  };
  services.completeTask.mockResolvedValue(result);
  services.cancelTask.mockResolvedValue(result);
  services.deleteTask.mockResolvedValue(result);
});

describe("task transition actions", () => {
  it("executes complete, cancel, and delete for legacy follow-up task IDs", async () => {
    const data = new FormData();
    data.set("taskId", legacyId);

    await completeTaskAction(data);
    await cancelTaskAction(data);
    await deleteTaskAction(data);

    expect(services.completeTask).toHaveBeenCalledWith("owner-a", legacyId);
    expect(services.cancelTask).toHaveBeenCalledWith("owner-a", legacyId);
    expect(services.deleteTask).toHaveBeenCalledWith("owner-a", legacyId);
  });

  it("does not call mutations for arbitrary malformed IDs", async () => {
    const data = new FormData();
    data.set("taskId", "not-a-task");
    await completeTaskAction(data);
    expect(services.completeTask).not.toHaveBeenCalled();
  });
});
