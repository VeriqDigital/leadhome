"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-user";
import {
  cancelTask,
  completeTask,
  createTask,
  deleteTask,
  reopenTask,
  updateTask,
} from "@/lib/tasks/task-service";
import {
  taskIdSchema,
  taskInputSchema,
  taskValues,
} from "@/lib/tasks/task-validation";

export type TaskActionState = {
  success?: boolean;
  changed?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  taskId?: string;
};

function revalidateTaskPaths(leadId?: string | null) {
  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath("/inbox");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

export async function createTaskAction(
  _state: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const parsed = taskInputSchema.safeParse(taskValues(formData));
  if (!parsed.success) {
    return {
      message: "Please correct the highlighted fields.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const user = await requireUser();
  try {
    const result = await createTask(user.id, parsed.data);
    revalidateTaskPaths(parsed.data.leadId);
    return {
      success: true,
      changed: true,
      message: "Task created.",
      taskId: result.task.id,
    };
  } catch {
    return { message: "The task could not be created." };
  }
}

export async function updateTaskAction(
  taskId: string,
  _state: TaskActionState,
  formData: FormData,
): Promise<TaskActionState> {
  const [validId, parsed] = [
    taskIdSchema.safeParse(taskId),
    taskInputSchema.safeParse(taskValues(formData)),
  ];
  if (!validId.success || !parsed.success) {
    return {
      message: "Please correct the highlighted fields.",
      errors: parsed.success ? undefined : parsed.error.flatten().fieldErrors,
    };
  }
  const user = await requireUser();
  try {
    const result = await updateTask(user.id, taskId, parsed.data);
    if (result.kind === "not-found") return { message: "Task not found." };
    revalidateTaskPaths(parsed.data.leadId);
    return {
      success: true,
      changed: result.kind === "changed",
      message: result.kind === "changed" ? "Task updated." : "No changes to save.",
      taskId,
    };
  } catch {
    return { message: "The task could not be updated." };
  }
}

async function transition(
  taskId: string,
  operation: typeof completeTask,
): Promise<void> {
  const parsed = taskIdSchema.safeParse(taskId);
  if (!parsed.success) return;
  const user = await requireUser();
  const result = await operation(user.id, parsed.data);
  if (result.kind === "changed") {
    revalidateTaskPaths(result.task.lead?.id);
  }
}

export async function completeTaskAction(formData: FormData) {
  await transition(String(formData.get("taskId") ?? ""), completeTask);
}

export async function reopenTaskAction(formData: FormData) {
  await transition(String(formData.get("taskId") ?? ""), reopenTask);
}

export async function cancelTaskAction(formData: FormData) {
  await transition(String(formData.get("taskId") ?? ""), cancelTask);
}

export async function deleteTaskAction(formData: FormData) {
  await transition(String(formData.get("taskId") ?? ""), deleteTask);
}
