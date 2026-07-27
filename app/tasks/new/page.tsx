import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createTaskAction } from "@/app/actions/task-actions";
import { getConversationAnalysisTaskPrefill } from "@/lib/ai/conversation-analysis/task-prefill";
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
    analysis?: string;
    item?: string;
  }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const [leads, conversations, analysisPrefill] = await Promise.all([
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
    getConversationAnalysisTaskPrefill(
      user.id,
      params.analysis,
      params.item,
    ),
  ]);
  const [prefillLead, prefillConversation] = await Promise.all([
    analysisPrefill?.leadId &&
    !leads.some((lead) => lead.id === analysisPrefill.leadId)
      ? prisma.lead.findFirst({
          where: { id: analysisPrefill.leadId, userId: user.id },
          select: { id: true, name: true },
        })
      : null,
    analysisPrefill &&
    !conversations.some(
      (conversation) => conversation.id === analysisPrefill.conversationId,
    )
      ? prisma.conversation.findFirst({
          where: {
            id: analysisPrefill.conversationId,
            ownerId: user.id,
          },
          select: { id: true, subject: true },
        })
      : null,
  ]);
  const leadOptions = prefillLead ? [...leads, prefillLead] : leads;
  const conversationOptions = prefillConversation
    ? [...conversations, prefillConversation]
    : conversations;
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
        {analysisPrefill && (
          <p className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-100">
            This task was prefilled from a Conversation Intelligence suggestion.
            Review and edit every field before saving.
          </p>
        )}
        <TaskForm
          action={createTaskAction}
          leads={leadOptions}
          conversations={conversationOptions}
          initial={
            analysisPrefill ?? {
              title: params.title,
              leadId: params.lead,
              conversationId: params.conversation,
              type:
                params.type === "CALL" ||
                params.type === "EMAIL" ||
                params.type === "MEETING" ||
                params.type === "GENERAL"
                  ? params.type
                  : "FOLLOW_UP",
            }
          }
        />
      </section>
    </div>
  );
}
