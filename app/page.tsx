import { Suspense } from "react";
import Link from "next/link";
import type { LeadStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth-user";
import { getDashboardAttention } from "@/lib/dashboard/attention";
import { getDashboardLeadMetrics } from "@/lib/pipeline/dashboard-metrics";
import { ACTIVE_PIPELINE_STATUSES } from "@/lib/pipeline/metrics";
import { getDashboardRecentActivities } from "@/lib/activity-service";
import { reportOperationalError } from "@/lib/server-errors";
import {
  formatCurrency,
  statusLabels,
  statusValues,
} from "@/lib/lead-format";
import { Header, PipelineRow } from "./components";
import { RecentActivity } from "./recent-activity";
import {
  AttentionError,
  DashboardLoading,
  NeedsAttention,
  TodaysWork,
} from "./dashboard-work-surface";

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
  return (
    <div className="mx-auto max-w-315">
      <Header name={user.name ?? "there"} hour={new Date().getHours()} />
      <Suspense fallback={<DashboardLoading />}>
        <DashboardContent ownerId={user.id} />
      </Suspense>
    </div>
  );
}

async function DashboardContent({ ownerId }: { ownerId: string }) {
  const now = new Date();
  const [attention, leadMetrics, recentActivity] = await Promise.all([
    getDashboardAttention(ownerId, now).catch((error) => {
      reportOperationalError("dashboard attention query failed", error);
      return null;
    }),
    getDashboardLeadMetrics(ownerId, now).catch((error) => {
      reportOperationalError("dashboard business health query failed", error);
      return null;
    }),
    getDashboardRecentActivities(ownerId, 5).catch((error) => {
      reportOperationalError("dashboard recent activity query failed", error);
      return null;
    }),
  ]);

  return (
    <div className="dashboard-work-surface">
      {attention ? (
        <>
          <NeedsAttention attention={attention} />
          <TodaysWork attention={attention} now={now} />
        </>
      ) : (
        <AttentionError />
      )}
      <BusinessHealth metrics={leadMetrics} activities={recentActivity} now={now} />
    </div>
  );
}

function BusinessHealth({
  metrics,
  activities,
  now,
}: {
  metrics: Awaited<ReturnType<typeof getDashboardLeadMetrics>> | null;
  activities: Awaited<ReturnType<typeof getDashboardRecentActivities>> | null;
  now: Date;
}) {
  const counts = Object.fromEntries(
    (metrics?.grouped ?? []).map((row) => [row.status, row._count]),
  ) as Partial<Record<LeadStatus, number>>;
  const maximum = Math.max(1, ...Object.values(counts));
  const activeCount = ACTIVE_PIPELINE_STATUSES.reduce(
    (total, status) => total + (counts[status] ?? 0),
    0,
  );
  const health = metrics
    ? [
        {
          label: "Open pipeline",
          value: formatCurrency(
            metrics.pipelineValue._sum.estimatedValue?.toString() ?? 0,
          ),
        },
        { label: "Active opportunities", value: String(activeCount) },
        { label: "Won this week", value: String(metrics.wonThisWeek) },
        { label: "New-stage leads", value: String(metrics.newCount) },
      ]
    : [];

  return (
    <section aria-labelledby="business-health-heading" className="mt-14 border-t border-black/10 pt-6 dark:border-white/10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="business-health-heading" className="text-xl font-semibold tracking-[-0.025em]">
            Business health
          </h2>
          <p className="mt-1 text-sm text-[#687080]">
            Pipeline context and the latest meaningful changes.
          </p>
        </div>
        <Link href="/pipeline" className="text-sm font-semibold underline underline-offset-4">
          Open pipeline
        </Link>
      </div>

      {metrics ? (
        <dl className="mt-6 grid border-y border-black/10 sm:grid-cols-2 xl:grid-cols-4 dark:border-white/10">
          {health.map((item) => (
            <div key={item.label} className="border-b border-black/[0.07] py-5 sm:px-5 sm:first:pl-0 sm:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0 dark:border-white/[0.07]">
              <dt className="text-xs font-medium uppercase tracking-[0.08em] text-[#687080]">{item.label}</dt>
              <dd className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p role="status" className="mt-6 border-y border-black/10 py-5 text-sm text-[#687080] dark:border-white/10">
          Business metrics are temporarily unavailable.
        </p>
      )}

      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section aria-labelledby="pipeline-distribution-heading">
          <h3 id="pipeline-distribution-heading" className="text-sm font-semibold uppercase tracking-[0.08em] text-[#687080]">
            Pipeline distribution
          </h3>
          {metrics ? (
            <ul className="mt-5 space-y-5">
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
          ) : (
            <p className="mt-5 text-sm text-[#687080]">Pipeline distribution is unavailable.</p>
          )}
        </section>
        <section aria-labelledby="recent-activity-heading" className="xl:border-l xl:border-black/10 xl:pl-8 dark:xl:border-white/10">
          <div className="flex items-center justify-between gap-3">
            <h3 id="recent-activity-heading" className="text-sm font-semibold uppercase tracking-[0.08em] text-[#687080]">
              What changed
            </h3>
            <Link href="/leads" className="text-xs font-semibold underline underline-offset-4">
              View leads
            </Link>
          </div>
          {activities ? (
            <RecentActivity activities={activities} now={now} />
          ) : (
            <p role="status" className="mt-5 text-sm text-[#687080]">Recent activity is temporarily unavailable.</p>
          )}
        </section>
      </div>
    </section>
  );
}
