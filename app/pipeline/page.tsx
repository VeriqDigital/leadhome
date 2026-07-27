import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import type { LeadSource, LeadStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth-user";
import {
  formatCurrency,
  sourceLabels,
  sourceValues,
} from "@/lib/lead-format";
import {
  PIPELINE_CARD_LIMIT,
  PIPELINE_MAX_COLUMN_LIMIT,
  getPipelineBoard,
  type PipelineSort,
} from "@/lib/pipeline/pipeline-query";
import { PageHeader } from "@/app/page-header";
import { PipelineBoard } from "./pipeline-board";

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;
const sorts = [
  { value: "urgency", label: "Follow-up urgency" },
  { value: "updated-desc", label: "Recently updated" },
  { value: "value-desc", label: "Highest value" },
  { value: "value-asc", label: "Lowest value" },
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
] as const;
const followUps = ["overdue", "today", "upcoming", "none"] as const;
const statuses = [
  "NEW",
  "CONTACTED",
  "FOLLOW_UP",
  "PROPOSAL_SENT",
  "NEGOTIATING",
  "WON",
  "LOST",
] as const;

function number(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const source = sourceValues.includes(one(params.source) as LeadSource)
    ? (one(params.source) as LeadSource)
    : undefined;
  const followUp = followUps.includes(
    one(params.followUp) as (typeof followUps)[number],
  )
    ? (one(params.followUp) as (typeof followUps)[number])
    : undefined;
  const sort = sorts.some((option) => option.value === one(params.sort))
    ? (one(params.sort) as PipelineSort)
    : "urgency";
  const limits = Object.fromEntries(
    statuses.map((status) => {
      const requested = Number(one(params[`limit_${status}`]));
      return [
        status,
        Number.isSafeInteger(requested) && requested > PIPELINE_CARD_LIMIT
          ? Math.min(requested, PIPELINE_MAX_COLUMN_LIMIT)
          : PIPELINE_CARD_LIMIT,
      ];
    }),
  ) as Record<LeadStatus, number>;
  const board = await getPipelineBoard(user.id, {
    query: one(params.q),
    source,
    minimumValue: number(one(params.minValue)),
    maximumValue: number(one(params.maxValue)),
    followUp,
    hasOpenTasks: one(params.hasTasks) === "yes" || undefined,
    hasConversation: one(params.hasConversation) === "yes" || undefined,
    sort,
    limits,
  });
  const loadMoreHref = (status: LeadStatus) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value) query.set(key, value);
    }
    query.set(
      `limit_${status}`,
      String(
        Math.min(limits[status] + PIPELINE_CARD_LIMIT, PIPELINE_MAX_COLUMN_LIMIT),
      ),
    );
    return `/pipeline?${query}`;
  };

  return (
    <div className="mx-auto max-w-[1800px]">
      <PageHeader
        title="Pipeline"
        description="Move opportunities through each sales stage and keep follow-up visible."
      />
      <section
        aria-label="Pipeline summary"
        className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Summary label="Active pipeline value" value={formatCurrency(board.summary.activePipelineValue)} />
        <Summary label="Active opportunities" value={String(board.summary.activeOpportunityCount)} />
        <Summary label="Overdue follow-ups" value={String(board.summary.overdueFollowUpCount)} />
        <Summary label="Won value this week" value={formatCurrency(board.summary.wonValueThisWeek)} />
      </section>
      <section className="dashboard-card mt-5 rounded-2xl border border-black/[0.07] bg-white p-4">
        <form className="flex flex-wrap gap-3">
          <label className="relative min-w-64 flex-1">
            <Search className="absolute left-3.5 top-3 size-4 text-[#687080]" />
            <input
              name="q"
              defaultValue={one(params.q)}
              placeholder="Search lead, company, or email"
              className="h-10 w-full rounded-xl border border-black/10 bg-transparent pl-10 pr-3 text-sm"
            />
          </label>
          <Filter name="source" value={source ?? ""}>
            <option value="">All sources</option>
            {sourceValues.map((value) => (
              <option key={value} value={value}>{sourceLabels[value]}</option>
            ))}
          </Filter>
          <Filter name="followUp" value={followUp ?? ""}>
            <option value="">All follow-up states</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="none">No follow-up</option>
          </Filter>
          <Filter name="hasTasks" value={one(params.hasTasks) ?? ""}>
            <option value="">Any task state</option>
            <option value="yes">Has open tasks</option>
          </Filter>
          <Filter name="hasConversation" value={one(params.hasConversation) ?? ""}>
            <option value="">Any conversation state</option>
            <option value="yes">Has conversation</option>
          </Filter>
          <Filter name="sort" value={sort}>
            {sorts.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Filter>
          <label className="flex items-center gap-2 text-xs">
            <span>Value</span>
            <input
              name="minValue"
              type="number"
              min="0"
              placeholder="Min"
              defaultValue={one(params.minValue)}
              className="h-10 w-24 rounded-xl border border-black/10 bg-transparent px-3"
            />
            <span>–</span>
            <input
              name="maxValue"
              type="number"
              min="0"
              placeholder="Max"
              defaultValue={one(params.maxValue)}
              className="h-10 w-24 rounded-xl border border-black/10 bg-transparent px-3"
            />
          </label>
          <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-black/10 px-4 text-sm font-semibold">
            <SlidersHorizontal className="size-4" /> Apply
          </button>
          <Link href="/pipeline" className="grid h-10 place-items-center px-2 text-xs font-semibold underline">
            Clear
          </Link>
        </form>
      </section>
      <div className="mt-4">
        <PipelineBoard
          key={board.columns
            .map((column) => `${column.status}:${column.count}:${column.cards.map((card) => card.id).join(",")}`)
            .join("|")}
          initialColumns={board.columns.map((column) => ({
            ...column,
            loadMoreHref: loadMoreHref(column.status),
          }))}
        />
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card rounded-2xl border border-black/[0.07] bg-white p-4">
      <p className="text-xs text-[#687080]">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </article>
  );
}

function Filter({
  name,
  value,
  children,
}: {
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="sr-only">{name}</span>
      <select
        name={name}
        defaultValue={value}
        className="h-10 cursor-pointer rounded-xl border border-black/10 bg-transparent px-3 text-sm"
      >
        {children}
      </select>
    </label>
  );
}
