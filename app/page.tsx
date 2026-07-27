import Link from "next/link";
import {
  CalendarClock,
  CircleDollarSign,
  TrendingUp,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import type { LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-user";
import {
  formatCurrency,
  formatRelativeTime,
  sourceLabels,
  statusLabels,
  statusValues,
} from "@/lib/lead-format";
import {
  DashboardCard,
  Header,
  MetricCard,
  PipelineRow,
  SmallAction,
} from "./components";
import { RecentLeads, type RecentLead } from "./recent-leads";
import { completeTaskAction } from "./actions/task-actions";
import { TaskDue } from "./tasks/task-due";

const colors: Record<LeadStatus, string> = {
  NEW: "#8c83d9",
  CONTACTED: "#e7bb5f",
  FOLLOW_UP: "#df9a59",
  PROPOSAL_SENT: "#df8a59",
  NEGOTIATING: "#82a86f",
  WON: "#66ad76",
  LOST: "#9ca3af",
};
export default async function Home() {
  const user = await requireUser();
  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const taskSelect = {
    id: true,
    title: true,
    dueAt: true,
    lead: { select: { id: true, name: true } },
  } as const;
  const [recent, newCount, followUpCount, wonThisWeek, pipelineValue, grouped, overdueTasks, todayTasks, upcomingTasks] =
    await Promise.all([
      prisma.lead.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.lead.count({ where: { userId: user.id, status: "NEW" } }),
      prisma.lead.count({
        where: {
          userId: user.id,
          nextFollowUpDate: { lt: endOfToday },
        },
      }),
      prisma.lead.count({
        where: {
          userId: user.id,
          status: "WON",
          updatedAt: { gte: startOfWeek },
        },
      }),
      prisma.lead.aggregate({
        where: { userId: user.id, status: { notIn: ["WON", "LOST"] } },
        _sum: { estimatedValue: true },
      }),
      prisma.lead.groupBy({
        by: ["status"],
        where: { userId: user.id },
        _count: true,
      }),
      prisma.task.findMany({
        where: { ownerId: user.id, status: "OPEN", dueAt: { lt: startOfToday } },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: 5,
        select: taskSelect,
      }),
      prisma.task.findMany({
        where: {
          ownerId: user.id,
          status: "OPEN",
          dueAt: { gte: startOfToday, lt: endOfToday },
        },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: 5,
        select: taskSelect,
      }),
      prisma.task.findMany({
        where: { ownerId: user.id, status: "OPEN", dueAt: { gte: endOfToday } },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: 5,
        select: taskSelect,
      }),
    ]);
  const counts = Object.fromEntries(
    grouped.map((row) => [row.status, row._count]),
  ) as Partial<Record<LeadStatus, number>>;
  const maximum = Math.max(1, ...Object.values(counts));
  const metrics = [
    {
      label: "New Leads",
      value: String(newCount),
      trend: "Live",
      period: "in your pipeline",
      icon: UserRoundPlus,
      tone: "neutral",
    },
    {
      label: "Needs Follow-up",
      value: String(followUpCount),
      trend: "Live",
      period: "requiring attention",
      icon: CalendarClock,
      tone: "neutral",
    },
    {
      label: "Won This Week",
      value: String(wonThisWeek),
      trend: "Live",
      period: "updated this week",
      icon: TrendingUp,
      tone: "green",
    },
    {
      label: "Pipeline Value",
      value: formatCurrency(pipelineValue._sum.estimatedValue?.toString() ?? 0),
      trend: "Live",
      period: "open opportunities",
      icon: CircleDollarSign,
      tone: "neutral",
    },
  ];
  const recentLeads: RecentLead[] = recent.map((lead) => ({
    id: lead.id,
    initials: lead.name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    name: lead.name,
    source: sourceLabels[lead.source],
    time: formatRelativeTime(lead.createdAt),
    status: statusLabels[lead.status],
    message: lead.message || lead.company || "No notes added.",
  }));

  return (
    <div className="mx-auto max-w-315">
      <Header name={user.name ?? "there"} hour={new Date().getHours()} />
      <section
        aria-label="Lead metrics"
        className="mt-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,2.08fr)_minmax(300px,1fr)]">
        <div className="grid gap-5">
          <DashboardCard
            title="Recent Leads"
            action={
              <Link href="/leads">
                <SmallAction>View all leads</SmallAction>
              </Link>
            }
          >
            {recent.length ? (
              <RecentLeads leads={recentLeads} />
            ) : (
              <div className="grid min-h-72 place-items-center px-6 text-center">
                <div>
                  <UsersRound className="mx-auto size-8 text-[#9297a1]" />
                  <h3 className="mt-4 font-semibold">
                    Your leads will live here
                  </h3>
                  <p className="mt-1 text-sm text-[#687080]">
                    Add your first lead to start building your pipeline.
                  </p>
                  <Link
                    href="/leads/new"
                    className="mt-5 inline-flex rounded-xl bg-[#17181c] px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    Create your first lead
                  </Link>
                </div>
              </div>
            )}
          </DashboardCard>
          <DashboardCard
            title="Due Today"
            action={<Link href="/tasks?view=today" className="text-xs text-[#606775]">View all</Link>}
          >
            <DashboardTasks tasks={todayTasks} now={now} empty="No tasks due today." />
          </DashboardCard>
        </div>
        <div className="grid gap-5">
          <DashboardCard title="Pipeline Overview">
            <ul className="space-y-6 px-6 py-6">
              {statusValues.map((status) => (
                <PipelineRow
                  key={status}
                  stage={statusLabels[status]}
                  count={counts[status] ?? 0}
                  width={`${((counts[status] ?? 0) / maximum) * 100}%`}
                  color={colors[status]}
                />
              ))}
            </ul>
          </DashboardCard>
          <DashboardCard
            title="Overdue Tasks"
            action={<Link href="/tasks?view=overdue" className="text-xs text-[#606775]">View all</Link>}
          >
            <DashboardTasks tasks={overdueTasks} now={now} empty="No overdue tasks." />
          </DashboardCard>
          <DashboardCard
            title="Upcoming Tasks"
            action={<Link href="/tasks?view=upcoming" className="text-xs text-[#606775]">View all</Link>}
          >
            <DashboardTasks tasks={upcomingTasks} now={now} empty="No upcoming tasks." />
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}

function DashboardTasks({
  tasks,
  now,
  empty,
}: {
  tasks: {
    id: string;
    title: string;
    dueAt: Date | null;
    lead: { id: string; name: string } | null;
  }[];
  now: Date;
  empty: string;
}) {
  if (!tasks.length) {
    return <p className="px-6 py-8 text-center text-sm text-[#687080]">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-black/[0.07] px-6">
      {tasks.map((task) => (
        <li key={task.id} className="flex min-h-18 items-center gap-3 py-3">
          <div className="min-w-0">
            <Link href={`/tasks/${task.id}/edit`} className="block truncate text-[13px] font-semibold hover:underline">
              {task.title}
            </Link>
            <p className="mt-1 truncate text-xs text-[#687080]">
              {task.lead?.name ?? "Standalone task"}
            </p>
          </div>
          <span className="ml-auto shrink-0 text-xs">
            <TaskDue
              dueAt={task.dueAt?.toISOString() ?? null}
              overdue={Boolean(task.dueAt && task.dueAt < now)}
            />
          </span>
          <form action={completeTaskAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <button
              aria-label={`Complete ${task.title}`}
              className="size-5 cursor-pointer rounded-[5px] border border-[#b9bdc4] hover:bg-[#edf6ee]"
            />
          </form>
        </li>
      ))}
    </ul>
  );
}
