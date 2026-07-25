import Link from "next/link";
import {
  BellRing,
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
  ReminderItem,
  SmallAction,
  TaskRow,
  ViewAll,
} from "./components";
import { demoReminders, demoTasks } from "./demo-fixtures";
import { RecentLeads, type RecentLead } from "./recent-leads";

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
  const [recent, newCount, followUpCount, wonThisWeek, pipelineValue, grouped] =
    await Promise.all([
      prisma.lead.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.lead.count({ where: { userId: user.id, status: "NEW" } }),
      prisma.lead.count({ where: { userId: user.id, status: "FOLLOW_UP" } }),
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
      icon: BellRing,
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
          <DashboardCard title="Reminders" action={<ViewAll />}>
            <div className="flex gap-6 px-6 py-5 max-md:flex-col">
              {demoReminders.map((reminder) => (
                <ReminderItem key={reminder.name} {...reminder} />
              ))}
            </div>
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
          <DashboardCard title="Upcoming Tasks" action={<ViewAll />}>
            <ul className="px-6">
              {demoTasks.map((task) => (
                <TaskRow key={task.title} {...task} />
              ))}
            </ul>
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}
