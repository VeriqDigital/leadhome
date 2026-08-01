import Link from "next/link";
import { Plus, Search, SquareCheckBig } from "lucide-react";
import type { TaskPriority, TaskType } from "@prisma/client";
import { requireUser } from "@/lib/auth-user";
import {
  TASK_PAGE_SIZE,
  isOverdue,
  listTasks,
  type TaskSort,
} from "@/lib/tasks/task-service";
import {
  cancelTaskAction,
  completeTaskAction,
  deleteTaskAction,
  reopenTaskAction,
} from "@/app/actions/task-actions";
import { PageHeader } from "@/app/page-header";
import { TaskDue } from "./task-due";
import { TaskActionButton } from "./task-action-button";

type Params = {
  q?: string;
  view?: string;
  type?: string;
  priority?: string;
  sort?: string;
  lead?: string;
  page?: string;
};
const views = [
  "open",
  "today",
  "upcoming",
  "overdue",
  "completed",
  "cancelled",
  "all",
] as const;
const types = ["GENERAL", "CALL", "EMAIL", "MEETING", "FOLLOW_UP"] as const;
const priorities = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const sorts = [
  { value: "due-asc", label: "Due date: soonest" },
  { value: "due-desc", label: "Due date: latest" },
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "updated-desc", label: "Recently updated" },
  { value: "updated-asc", label: "Oldest updated" },
  { value: "priority-desc", label: "Highest priority" },
  { value: "priority-asc", label: "Lowest priority" },
] as const;
const label = (value: string) =>
  value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (x) => x.toUpperCase());

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const view = views.includes(params.view as (typeof views)[number])
    ? (params.view as (typeof views)[number])
    : "open";
  const type = types.includes(params.type as TaskType)
    ? (params.type as TaskType)
    : undefined;
  const priority = priorities.includes(params.priority as TaskPriority)
    ? (params.priority as TaskPriority)
    : undefined;
  const sort = sorts.some((option) => option.value === params.sort)
    ? (params.sort as TaskSort)
    : "due-asc";
  const rawPage = Number(params.page);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const result = await listTasks(user.id, {
    page,
    view,
    type,
    priority,
    sort,
    leadId: params.lead || undefined,
    query: params.q,
  });
  const href = (nextPage: number) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (view !== "open") query.set("view", view);
    if (type) query.set("type", type);
    if (priority) query.set("priority", priority);
    if (sort !== "due-asc") query.set("sort", sort);
    if (params.lead) query.set("lead", params.lead);
    if (nextPage > 1) query.set("page", String(nextPage));
    return `/tasks${query.size ? `?${query}` : ""}`;
  };
  const currentHref = href(page);

  return (
    <div className="mx-auto max-w-315">
      <PageHeader
        title="Tasks"
        description="Keep the next action for every lead in view."
        action={
          <Link
            href="/tasks/new"
            className="action-primary inline-flex h-11 items-center gap-2 rounded-xl border border-transparent px-4 text-sm font-semibold"
          >
            <Plus className="size-4" /> New task
          </Link>
        }
      />
      <section className="dashboard-card mt-9 rounded-2xl border border-black/5.5 bg-white p-6">
        <form className="flex flex-wrap gap-3">
          <label className="relative min-w-64 flex-1">
            <Search className="absolute left-3.5 top-3 size-4 text-[#687080]" />
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Search tasks or leads"
              className="h-10 w-full rounded-xl border border-black/10 bg-transparent pl-10 pr-3 text-sm"
            />
          </label>
          <TaskFilter name="view" value={view} options={views} />
          <TaskFilter name="type" value={type ?? ""} options={types} all="All types" />
          <TaskFilter name="priority" value={priority ?? ""} options={priorities} all="All priorities" />
          <label>
            <span className="sr-only">Sort tasks</span>
            <select
              name="sort"
              defaultValue={sort}
              className="h-10 cursor-pointer rounded-xl border border-black/10 bg-transparent px-3 text-sm"
            >
              {sorts.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className="cursor-pointer rounded-xl border border-black/10 px-4 text-sm font-semibold hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
            Apply
          </button>
        </form>
        {view === "overdue" && (
          <p role="status" className="mt-3 text-xs text-[#687080]">
            Showing open tasks that are past their due time.
          </p>
        )}
        {result.items.length ? (
          <ul className="mt-6 divide-y divide-black/[0.07] dark:divide-white/[0.08]">
            {result.items.map((task) => {
              const overdue = isOverdue(task);
              return (
                <li
                  key={task.id}
                  className="grid gap-3 py-4 md:grid-cols-[minmax(180px,1fr)_150px_180px_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{task.title}</p>
                    <p className="mt-1 truncate text-xs text-[#687080]">
                      {label(task.type)} · {label(task.priority)}
                      {task.lead ? ` · ${task.lead.name}` : ""}
                      {task.conversation
                        ? ` · ${task.conversation.subject ?? "No subject"}`
                        : ""}
                    </p>
                  </div>
                  <span className="text-xs font-medium">{label(task.status)}</span>
                  <span className="text-xs">
                    <TaskDue dueAt={task.dueAt?.toISOString() ?? null} overdue={overdue} />
                  </span>
                  <div className="flex flex-wrap justify-end gap-2">
                    {task.status === "OPEN" ? (
                      <TaskAction action={completeTaskAction} id={task.id} pendingLabel="Completing…">Complete</TaskAction>
                    ) : (
                      <TaskAction action={reopenTaskAction} id={task.id} pendingLabel="Reopening…">Reopen</TaskAction>
                    )}
                    <Link
                      href={`/tasks/${task.id}/edit?returnTo=${encodeURIComponent(currentHref)}`}
                      className="rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                    >
                      Edit
                    </Link>
                    {task.status === "OPEN" && (
                      <TaskAction action={cancelTaskAction} id={task.id} pendingLabel="Cancelling…">Cancel</TaskAction>
                    )}
                    <TaskAction action={deleteTaskAction} id={task.id} pendingLabel="Deleting…">Delete</TaskAction>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="grid min-h-64 place-items-center text-center">
            <div>
              <SquareCheckBig className="mx-auto size-8 text-[#9297a1]" />
              <h2 className="mt-3 font-semibold">No tasks found</h2>
              <p className="mt-1 text-sm text-[#687080]">
                Create a task or adjust the current filters.
              </p>
            </div>
          </div>
        )}
        {(result.hasPrevious || result.hasNext) && (
          <nav className="mt-5 flex items-center justify-between text-sm" aria-label="Task pagination">
            {result.hasPrevious ? <Link href={href(page - 1)}>Previous</Link> : <span />}
            <span className="text-xs text-[#687080]">
              Page {page} · up to {TASK_PAGE_SIZE} tasks
            </span>
            {result.hasNext ? <Link href={href(page + 1)}>Next</Link> : <span />}
          </nav>
        )}
      </section>
    </div>
  );
}

function TaskFilter({
  name,
  value,
  options,
  all,
}: {
  name: string;
  value: string;
  options: readonly string[];
  all?: string;
}) {
  return (
    <label>
      <span className="sr-only">{name}</span>
      <select
        name={name}
        defaultValue={value}
        className="h-10 cursor-pointer rounded-xl border border-black/10 bg-transparent px-3 text-sm"
      >
        {all && <option value="">{all}</option>}
        {options.map((option) => (
          <option key={option} value={option}>{label(option)}</option>
        ))}
      </select>
    </label>
  );
}

function TaskAction({
  action,
  id,
  pendingLabel,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="taskId" value={id} />
      <TaskActionButton
        label={String(children)}
        pendingLabel={pendingLabel}
      />
    </form>
  );
}
