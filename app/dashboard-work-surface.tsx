import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import type {
  AttentionCategory,
  DashboardAttention,
  DashboardWorkItem,
} from "@/lib/dashboard/attention";
import { formatRelativeTime } from "@/lib/lead-format";

const severityLabel = {
  urgent: "Act now",
  high: "Important",
  normal: "Review",
} as const;

const severityStyle = {
  urgent: "bg-red-500",
  high: "bg-amber-500",
  normal: "bg-[#7770c8]",
} as const;

function countLabel(category: AttentionCategory) {
  if (category.count === 0 && category.countIsLowerBound) return "Review";
  return `${category.count}${category.countIsLowerBound ? "+" : ""}`;
}

function totalLabel(attention: DashboardAttention) {
  if (attention.totalCount === 0 && attention.totalCountIsLowerBound) {
    return "Additional records may need review";
  }
  return `${attention.totalCount}${attention.totalCountIsLowerBound ? "+" : ""} actionable ${attention.totalCount === 1 ? "item" : "items"}`;
}

export function NeedsAttention({
  attention,
}: {
  attention: DashboardAttention;
}) {
  const actionable = attention.categories.filter(
    (category) => category.count > 0 || category.countIsLowerBound,
  );
  return (
    <section aria-labelledby="needs-attention-heading" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-black/10 pb-4 dark:border-white/10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7770c8]">
            Today
          </p>
          <h2 id="needs-attention-heading" className="mt-1 text-2xl font-semibold tracking-[-0.035em]">
            Needs attention
          </h2>
        </div>
        {!attention.caughtUp && (
          <p className="text-sm text-[#687080]">
            {totalLabel(attention)}
          </p>
        )}
      </div>
      {attention.caughtUp ? (
        <div className="flex items-start gap-4 border-b border-black/10 py-8 dark:border-white/10">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-6 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h3 className="font-semibold">You are caught up</h3>
            <p className="mt-1 text-sm text-[#687080]">
              No leads, tasks, or conversations currently require action.
            </p>
          </div>
        </div>
      ) : (
        <ol className="divide-y divide-black/[0.08] border-b border-black/10 dark:divide-white/[0.08] dark:border-white/10">
          {actionable.map((category, index) => (
            <li key={category.key}>
              <Link
                href={category.href}
                aria-label={`${countLabel(category)} ${category.title}. ${category.actionLabel}`}
                className={`group grid gap-3 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7770c8] sm:grid-cols-[10px_minmax(0,1fr)_80px_140px] sm:items-center sm:px-3 ${index === 0 ? "bg-black/[0.025] dark:bg-white/[0.035]" : ""}`}
              >
                <span aria-hidden="true" className={`hidden h-9 w-1 rounded-full sm:block ${severityStyle[category.severity]}`} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#687080]">
                    <span aria-hidden="true" className={`size-2 rounded-full sm:hidden ${severityStyle[category.severity]}`} />
                    {severityLabel[category.severity]}
                  </span>
                  <span className="mt-1 block text-[15px] font-semibold">
                    {category.title}
                  </span>
                  <span className="mt-1 block text-sm text-[#687080]">
                    {category.explanation}
                  </span>
                </span>
                <span className="text-2xl font-semibold tracking-[-0.04em] sm:text-right" aria-hidden="true">
                  {countLabel(category)}
                </span>
                <span className="inline-flex items-center gap-2 text-sm font-semibold sm:justify-end">
                  {category.actionLabel}
                  <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function WorkRow({ item, now }: { item: DashboardWorkItem; now: Date }) {
  return (
    <li>
      <Link
        href={item.href}
        aria-label={`${item.action}: ${item.title}`}
        className="group grid gap-2 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7770c8] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_120px_24px] sm:items-center"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{item.title}</span>
          <span className="mt-1 block truncate text-xs text-[#687080]">{item.context}</span>
        </span>
        <span className="text-sm">{item.action}</span>
        <time dateTime={item.relevantAt.toISOString()} className="text-xs text-[#687080] sm:text-right">
          {formatRelativeTime(item.relevantAt, now)}
        </time>
        <ArrowRight aria-hidden="true" className="hidden size-4 text-[#687080] transition-transform group-hover:translate-x-0.5 sm:block" />
      </Link>
    </li>
  );
}

export function TodaysWork({ attention, now }: { attention: DashboardAttention; now: Date }) {
  return (
    <section aria-labelledby="todays-work-heading" className="mt-12">
      <div className="border-b border-black/10 pb-4 dark:border-white/10">
        <h2 id="todays-work-heading" className="text-xl font-semibold tracking-[-0.025em]">
          Today&apos;s work
        </h2>
        <p className="mt-1 text-sm text-[#687080]">
          A bounded shortlist of the next records worth opening.
        </p>
      </div>
      {attention.workItems.length ? (
        <ul className="divide-y divide-black/[0.08] dark:divide-white/[0.08]">
          {attention.workItems.map((item) => (
            <WorkRow key={item.id} item={item} now={now} />
          ))}
        </ul>
      ) : (
        <p className="border-b border-black/10 py-7 text-sm text-[#687080] dark:border-white/10">
          There is no urgent work in today&apos;s shortlist. Upcoming tasks remain available on the Tasks page.
        </p>
      )}
    </section>
  );
}

export function AttentionError() {
  return (
    <section aria-labelledby="needs-attention-heading" className="mt-10 border-y border-black/10 py-7 dark:border-white/10">
      <h2 id="needs-attention-heading" className="text-2xl font-semibold tracking-[-0.035em]">
        Needs attention
      </h2>
      <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
        The attention queue could not be loaded. Your Inbox, Leads, and Tasks pages are still available.
      </p>
      <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold">
        <Link href="/inbox">Open Inbox</Link>
        <Link href="/leads">Open Leads</Link>
        <Link href="/tasks">Open Tasks</Link>
      </div>
    </section>
  );
}

export function DashboardLoading() {
  return (
    <div role="status" aria-live="polite" className="mt-10 border-y border-black/10 py-10 text-sm text-[#687080] dark:border-white/10">
      Loading today&apos;s work…
    </div>
  );
}
