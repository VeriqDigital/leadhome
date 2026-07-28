import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  cancelTask: vi.fn(),
  deleteTask: vi.fn(),
}));
const cache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-user", () => ({
  requireUser: vi.fn(async () => ({ id: "owner-a" })),
}));
vi.mock("@/lib/tasks/task-service", () => services);
vi.mock("next/cache", () => ({ revalidatePath: cache.revalidatePath }));

import {
  cancelTaskAction,
  completeTaskAction,
  createTaskAction,
  deleteTaskAction,
} from "./task-actions";

const legacyId = "legacy-follow-up-cmryaj3vu000nl204zwq591w3";
const leadId = "cm123456789012345678901234";

function createForm() {
  const data = new FormData();
  data.set("title", "Call customer");
  data.set("description", "");
  data.set("type", "FOLLOW_UP");
  data.set("priority", "NORMAL");
  data.set("status", "OPEN");
  data.set("dueAt", "2026-08-12");
  data.set("leadId", leadId);
  data.set("conversationId", "");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  const result = {
    kind: "changed",
    task: { id: legacyId, lead: null },
  };
  services.completeTask.mockResolvedValue(result);
  services.cancelTask.mockResolvedValue(result);
  services.deleteTask.mockResolvedValue(result);
  services.createTask.mockResolvedValue({
    kind: "changed",
    task: { id: "cm987654321098765432109876", lead: { id: leadId } },
  });
});

describe("task transition actions", () => {
  it("creates once and invalidates the affected lead route exactly once", async () => {
    await expect(createTaskAction({}, createForm())).resolves.toEqual({
      success: true,
      changed: true,
      message: "Task created.",
      taskId: "cm987654321098765432109876",
    });

    expect(services.createTask).toHaveBeenCalledTimes(1);
    expect(cache.revalidatePath.mock.calls.filter(
      ([path]) => path === `/leads/${leadId}`,
    )).toHaveLength(1);
  });

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

  it("does not revalidate or write again for an unchanged transition", async () => {
    services.completeTask.mockResolvedValueOnce({
      kind: "unchanged",
      task: { id: legacyId, lead: null },
    });
    const data = new FormData();
    data.set("taskId", legacyId);

    await completeTaskAction(data);

    expect(services.completeTask).toHaveBeenCalledTimes(1);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});
