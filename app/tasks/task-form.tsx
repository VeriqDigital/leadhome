"use client";

import { startTransition, useActionState, useState } from "react";
import type { TaskPriority, TaskType } from "@prisma/client";
import type { TaskActionState } from "@/app/actions/task-actions";

type Option = { id: string; name: string };
type ConversationOption = { id: string; subject: string | null };

export function taskFieldResetKey(
  state: TaskActionState,
  submitLabel: string,
) {
  return state.success && submitLabel === "Create task"
    ? state.taskId
    : undefined;
}

export function shouldShowTaskMessage(
  state: TaskActionState,
  acknowledgedTaskId?: string,
) {
  return Boolean(
    state.message && (!state.taskId || state.taskId !== acknowledgedTaskId),
  );
}

export function TaskForm({
  action,
  leads,
  conversations,
  initial,
  submitLabel = "Create task",
}: {
  action: (
    state: TaskActionState,
    formData: FormData,
  ) => Promise<TaskActionState>;
  leads: Option[];
  conversations: ConversationOption[];
  initial?: {
    title?: string;
    description?: string | null;
    type?: TaskType;
    priority?: TaskPriority;
    status?: "OPEN" | "COMPLETED" | "CANCELLED";
    dueAt?: Date | null;
    leadId?: string | null;
    conversationId?: string | null;
  };
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [acknowledgedTaskId, setAcknowledgedTaskId] = useState<string>();
  const resetAfterCreation = taskFieldResetKey(state, submitLabel);
  const fieldInitial = resetAfterCreation ? undefined : initial;
  const dueDate = fieldInitial?.dueAt
    ? `${fieldInitial.dueAt.getFullYear()}-${String(fieldInitial.dueAt.getMonth() + 1).padStart(2, "0")}-${String(fieldInitial.dueAt.getDate()).padStart(2, "0")}`
    : "";
  const dueTime = fieldInitial?.dueAt
    ? `${String(fieldInitial.dueAt.getHours()).padStart(2, "0")}:${String(fieldInitial.dueAt.getMinutes()).padStart(2, "0")}`
    : "";
  const showMessage = shouldShowTaskMessage(state, acknowledgedTaskId);

  return (
    <form
      onInput={() => {
        if (state.taskId) setAcknowledgedTaskId(state.taskId);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        const date = String(data.get("dueDate") ?? "");
        const time = String(data.get("dueTime") ?? "");
        data.set(
          "dueAt",
          date
            ? time
              ? new Date(`${date}T${time}`).toISOString()
              : date
            : "",
        );
        startTransition(() => formAction(data));
      }}
      className="grid gap-4"
    >
      <div key={resetAfterCreation ?? "task-fields"} className="contents">
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          Title
          <input
            name="title"
            required
            maxLength={160}
            defaultValue={fieldInitial?.title}
            className="h-11 w-full min-w-0 rounded-xl border border-black/10 bg-transparent px-3"
          />
          {state.errors?.title && (
            <span className="text-xs text-red-600">{state.errors.title[0]}</span>
          )}
        </label>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <TaskSelect
            name="type"
            label="Type"
            defaultValue={fieldInitial?.type ?? "FOLLOW_UP"}
            options={["GENERAL", "CALL", "EMAIL", "MEETING", "FOLLOW_UP"]}
          />
          <TaskSelect
            name="priority"
            label="Priority"
            defaultValue={fieldInitial?.priority ?? "NORMAL"}
            options={["LOW", "NORMAL", "HIGH", "URGENT"]}
          />
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            Due date
            <input
              type="date"
              name="dueDate"
              defaultValue={dueDate}
              className="h-11 w-full min-w-0 rounded-xl border border-black/10 bg-transparent px-3"
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            Due time <span className="text-xs font-normal text-[#687080]">(optional)</span>
            <input
              type="time"
              name="dueTime"
              defaultValue={dueTime}
              className="h-11 w-full min-w-0 rounded-xl border border-black/10 bg-transparent px-3"
            />
          </label>
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            Lead
            <select
              name="leadId"
              defaultValue={fieldInitial?.leadId ?? ""}
              className="h-11 w-full min-w-0 rounded-xl border border-black/10 bg-transparent px-3"
            >
              <option value="">No linked lead</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>{lead.name}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            Conversation
            <select
              name="conversationId"
              defaultValue={fieldInitial?.conversationId ?? ""}
              className="h-11 w-full min-w-0 max-w-full rounded-xl border border-black/10 bg-transparent px-3"
            >
              <option value="">No linked conversation</option>
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.subject ?? "No subject"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          Notes
          <textarea
            name="description"
            maxLength={2000}
            rows={4}
            defaultValue={fieldInitial?.description ?? ""}
            className="w-full min-w-0 rounded-xl border border-black/10 bg-transparent p-3"
          />
        </label>
        <input type="hidden" name="status" value={fieldInitial?.status ?? "OPEN"} />
      </div>
      <div className="flex items-center gap-3">
        <button
          disabled={pending}
          className="cursor-pointer rounded-xl bg-[#17181c] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-[#17181c]"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <p
          aria-live="polite"
          className={`text-sm ${state.success ? "text-green-700 dark:text-green-400" : "text-red-600"}`}
        >
          {showMessage ? state.message : null}
        </p>
      </div>
    </form>
  );
}

function TaskSelect({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: readonly string[];
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      {label}
      <select
        name={name}
        defaultValue={defaultValue}
        className="h-11 w-full min-w-0 rounded-xl border border-black/10 bg-transparent px-3"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.toLowerCase().replaceAll("_", " ").replace(/^\w/, (x) => x.toUpperCase())}
          </option>
        ))}
      </select>
    </label>
  );
}
