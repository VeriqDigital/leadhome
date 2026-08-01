import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { updateTaskAction } from "@/app/actions/task-actions";
import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { getTask } from "@/lib/tasks/task-service";
import { TaskForm } from "../../task-form";
import { TaskLifecycleActions } from "../../task-lifecycle-actions";
import { safeTaskListReturnPath } from "../../task-return-path";

export default async function EditTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const returnTo = safeTaskListReturnPath((await searchParams).returnTo);
  const [task, leads, conversations] = await Promise.all([
    getTask(user.id, id),
    prisma.lead.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true },
    }),
    prisma.conversation.findMany({
      where: { ownerId: user.id },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      take: 500,
      select: { id: true, subject: true },
    }),
  ]);
  if (!task) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={returnTo} className="mb-5 inline-flex items-center gap-1 text-sm text-[#687080]">
        <ChevronLeft className="size-4" /> Back to tasks
      </Link>
      <section className="dashboard-card rounded-2xl border border-black/5.5 bg-white p-6 sm:p-8">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Edit task</h1>
          <TaskLifecycleActions
            taskId={task.id}
            status={task.status}
            deleteReturnTo={returnTo}
          />
        </div>
        <TaskForm
          key={task.id}
          action={updateTaskAction.bind(null, task.id)}
          leads={leads}
          conversations={conversations}
          initial={{
            ...task,
            leadId: task.lead?.id,
            conversationId: task.conversation?.id,
          }}
          submitLabel="Save task"
        />
      </section>
    </div>
  );
}
