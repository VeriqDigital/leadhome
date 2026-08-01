import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-user";
import { getLeadActivityPage } from "@/lib/activity-service";
import { formatDate, formatDateInputValue } from "@/lib/lead-format";
import {
  deleteLeadAction,
  markLeadContactedAction,
  updateLeadAction,
} from "../../actions/lead-actions";
import { createTaskAction } from "../../actions/task-actions";
import { ActivityTimeline } from "../activity-timeline";
import { DeleteLeadButton } from "../delete-lead-button";
import { LeadForm } from "../lead-form";
import { TaskForm } from "../../tasks/task-form";
import { TaskDue } from "../../tasks/task-due";
import { isOverdue } from "@/lib/tasks/task-service";
import { getConnectedGmailAddress } from "@/lib/gmail/connected-account";
import { GmailComposeLink } from "../gmail-compose-link";
import { MarkContactedButton } from "../mark-contacted-button";
export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const timelineNow = new Date();
  const timelineTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const lead = await prisma.lead.findFirst({ where: { id, userId: user.id } });
  if (!lead) notFound();
  const [activityPage, tasks, conversations, gmailAddress] = await Promise.all([
    getLeadActivityPage({ leadId: lead.id, ownerId: user.id }),
    prisma.task.findMany({
      where: { ownerId: user.id, leadId: lead.id, status: { not: "CANCELLED" } },
      orderBy: [
        { status: "asc" },
        { dueAt: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ],
      take: 8,
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        dueAt: true,
      },
    }),
    prisma.conversation.findMany({
      where: { ownerId: user.id, leadId: lead.id },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      take: 100,
      select: { id: true, subject: true },
    }),
    getConnectedGmailAddress(user.id),
  ]);
  const update = updateLeadAction.bind(null, lead.id);
  const remove = deleteLeadAction.bind(null, lead.id);
  const markContacted = markLeadContactedAction.bind(null, lead.id);
  return (
    <div className="mx-auto max-w-315">
      <Link
        href="/leads"
        className="mb-5 inline-flex items-center gap-1 text-sm text-[#687080] hover:text-black"
      >
        <ChevronLeft className="size-4" />
        Back to leads
      </Link>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <section className="dashboard-card rounded-2xl border border-black/5.5 bg-white p-6 shadow-[0_8px_30px_rgba(23,24,28,0.035)] sm:p-8">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {lead.name}
              </h1>
              <p className="mt-2 text-sm text-[#687080]">
                Created {formatDate(lead.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {lead.email ? (
                <GmailComposeLink
                  recipient={lead.email}
                  leadName={lead.name}
                  accountAddress={gmailAddress}
                  label="Contact in Gmail"
                />
              ) : (
                <span className="text-xs text-[#687080]">
                  Add an email to contact in Gmail
                </span>
              )}
              <MarkContactedButton action={markContacted} />
              <DeleteLeadButton action={remove} />
            </div>
          </div>
          {lead.email ? (
            <p className="-mt-5 mb-7 text-xs text-[#687080]">
              Gmail opens in a new tab. Sent email is recognized after the next Gmail check.
            </p>
          ) : null}
          <LeadForm
            action={update}
            submitLabel="Save changes"
            lead={{
              ...lead,
              estimatedValue: lead.estimatedValue?.toString() ?? null,
              nextFollowUp: formatDateInputValue(lead.nextFollowUpDate),
            }}
          />
          <section className="mt-10 border-t border-black/[0.07] pt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Tasks</h2>
                <p className="mt-1 text-sm text-[#687080]">
                  Open work and recent completed actions for this lead.
                </p>
              </div>
              <Link
                href={`/tasks?lead=${lead.id}`}
                className="text-sm font-semibold underline"
              >
                View all
              </Link>
            </div>
            {tasks.length ? (
              <ul className="mt-5 divide-y divide-black/[0.07]">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{task.title}</p>
                      <p className="mt-1 text-xs text-[#687080]">
                        {task.type.toLowerCase().replaceAll("_", " ")} · {task.status.toLowerCase()}
                      </p>
                    </div>
                    <span className="ml-auto text-xs">
                      <TaskDue
                        dueAt={task.dueAt?.toISOString() ?? null}
                        overdue={isOverdue(task)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-sm text-[#687080]">No tasks for this lead.</p>
            )}
            <details className="mt-6 rounded-xl border border-black/10 p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Add follow-up
              </summary>
              <div className="mt-5">
                <TaskForm
                  key={lead.id}
                  action={createTaskAction}
                  leads={[{ id: lead.id, name: lead.name }]}
                  conversations={conversations}
                  initial={{ leadId: lead.id, type: "FOLLOW_UP" }}
                />
              </div>
            </details>
          </section>
        </section>
        <ActivityTimeline
          activities={activityPage?.items ?? []}
          nextCursor={activityPage?.nextCursor ?? null}
          leadId={lead.id}
          now={timelineNow.toISOString()}
          timeZone={timelineTimeZone}
        />
      </div>
    </div>
  );
}
