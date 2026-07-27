import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createTaskAction } from "@/app/actions/task-actions";
import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { TaskForm } from "../task-form";

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{
    lead?: string;
    conversation?: string;
    title?: string;
    type?: string;
  }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const [leads, conversations] = await Promise.all([
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
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/tasks" className="mb-5 inline-flex items-center gap-1 text-sm text-[#687080]">
        <ChevronLeft className="size-4" /> Back to tasks
      </Link>
      <section className="dashboard-card rounded-2xl border border-black/5.5 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">New task</h1>
        <p className="mb-7 mt-2 text-sm text-[#687080]">
          A due task is also your reminder—there is no separate reminder record.
        </p>
        <TaskForm
          action={createTaskAction}
          leads={leads}
          conversations={conversations}
          initial={{
            title: params.title,
            leadId: params.lead,
            conversationId: params.conversation,
            type: params.type === "CALL" || params.type === "EMAIL" || params.type === "MEETING" || params.type === "GENERAL" ? params.type : "FOLLOW_UP",
          }}
        />
      </section>
    </div>
  );
}
