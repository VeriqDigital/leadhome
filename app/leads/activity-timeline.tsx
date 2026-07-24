import type { LeadSource, LeadStatus } from "@prisma/client";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Building2,
  CalendarClock,
  CircleDollarSign,
  ClipboardPenLine,
  ContactRound,
  Globe2,
  ListChecks,
  UserRoundPlus,
  Waypoints,
} from "lucide-react";
import {
  formatCurrency,
  formatDateOnly,
  formatDateTime,
  formatRelativeTime,
  sourceLabels,
  statusLabels,
} from "@/lib/lead-format";
import { StatusBadge } from "@/app/components";

const icons: Record<string, LucideIcon> = {
  LEAD_CREATED: UserRoundPlus,
  WEBSITE_SUBMISSION_RECEIVED: Globe2,
  STATUS_CHANGED: ListChecks,
  ESTIMATED_VALUE_CHANGED: CircleDollarSign,
  FOLLOW_UP_CHANGED: CalendarClock,
  CONTACT_INFO_CHANGED: ContactRound,
  COMPANY_CHANGED: Building2,
  NOTES_CHANGED: ClipboardPenLine,
  SOURCE_CHANGED: Waypoints,
};

export type TimelineActivity = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  metadata?: unknown;
  createdAt: Date;
};

type Presentation =
  | { kind: "status"; from: string; to: string; description: string }
  | { kind: "text"; description: string | null; detail?: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function has(object: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function status(value: unknown) {
  return typeof value === "string" && value in statusLabels
    ? statusLabels[value as LeadStatus]
    : null;
}

function source(value: unknown) {
  return typeof value === "string" && value in sourceLabels
    ? sourceLabels[value as LeadSource]
    : null;
}

function money(value: unknown) {
  if (value === null) return "No value";
  if ((typeof value === "number" || typeof value === "string") && value !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatCurrency(parsed) : null;
  }
  return null;
}

export function activityPresentation(activity: TimelineActivity): Presentation {
  const metadata = record(activity.metadata);
  if (!metadata) return { kind: "text", description: activity.description };

  if (activity.type === "STATUS_CHANGED") {
    const from = status(metadata.from);
    const to = status(metadata.to);
    if (from && to) {
      return {
        kind: "status",
        from,
        to,
        description: `${from} → ${to}`,
      };
    }
  }

  if (
    activity.type === "ESTIMATED_VALUE_CHANGED" &&
    has(metadata, "from") &&
    has(metadata, "to")
  ) {
    const from = money(metadata.from);
    const to = money(metadata.to);
    if (from && to) {
      return { kind: "text", description: `${from} → ${to}` };
    }
  }

  if (
    activity.type === "FOLLOW_UP_CHANGED" &&
    has(metadata, "from") &&
    has(metadata, "to")
  ) {
    const validDate = (value: unknown) =>
      value === null ||
      value instanceof Date ||
      (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value));
    if (validDate(metadata.from) && validDate(metadata.to)) {
      return {
        kind: "text",
        description: `${formatDateOnly(metadata.from)} → ${formatDateOnly(metadata.to)}`,
      };
    }
  }

  if (activity.type === "CONTACT_INFO_CHANGED") {
    const fields = (["name", "email", "phone"] as const).filter((field) =>
      has(metadata, field),
    );
    if (fields.length) {
      const labels = fields.map((field, index) =>
        index === 0 ? field[0].toUpperCase() + field.slice(1) : field,
      );
      const summary =
        labels.length === 1
          ? labels[0]
          : labels.length === 2
            ? `${labels[0]} and ${labels[1]}`
            : `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
      return {
        kind: "text",
        description: `${summary} updated`,
      };
    }
  }

  if (
    activity.type === "COMPANY_CHANGED" &&
    has(metadata, "from") &&
    has(metadata, "to")
  ) {
    const company = (value: unknown) =>
      typeof value === "string" && value ? value : "No company";
    return {
      kind: "text",
      description: `${company(metadata.from)} → ${company(metadata.to)}`,
    };
  }

  if (activity.type === "NOTES_CHANGED") {
    const previous = metadata.previousLength;
    const next = metadata.nextLength;
    const detail =
      typeof previous === "number" && typeof next === "number"
        ? `${previous} → ${next} characters`
        : undefined;
    return {
      kind: "text",
      description: activity.description,
      detail,
    };
  }

  if (
    activity.type === "SOURCE_CHANGED" &&
    has(metadata, "from") &&
    has(metadata, "to")
  ) {
    const from = source(metadata.from);
    const to = source(metadata.to);
    if (from && to) {
      return { kind: "text", description: `${from} → ${to}` };
    }
  }

  return { kind: "text", description: activity.description };
}

export function ActivityTimeline({
  activities,
  now = new Date(),
}: {
  activities: TimelineActivity[];
  now?: Date;
}) {
  return (
    <aside className="dashboard-card overflow-hidden rounded-2xl border border-black/5.5 bg-white shadow-[0_8px_30px_rgba(23,24,28,0.035)] lg:sticky lg:top-6">
      <header className="border-b border-black/6 px-6 py-5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Activity</h2>
        <p className="mt-1 text-xs text-[#687080]">History for this lead.</p>
      </header>
      {activities.length ? (
        <ol className="px-5 py-2 sm:px-6">
          {activities.map((activity, index) => {
            const Icon = icons[activity.type] ?? Activity;
            const presentation = activityPresentation(activity);
            const exact = formatDateTime(activity.createdAt);
            const relative = formatRelativeTime(activity.createdAt, now);
            return (
              <li
                key={activity.id}
                className="relative grid grid-cols-[30px_minmax(0,1fr)] gap-3 py-4.5"
              >
                {index < activities.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-[-18px] left-[14px] top-10 w-px bg-black/[0.08] dark:bg-white/[0.09]"
                  />
                )}
                <span
                  aria-hidden="true"
                  className="relative z-10 grid size-7.5 place-items-center rounded-full border border-black/[0.07] bg-[#f4f4f5] text-[#666b76] dark:border-white/10 dark:bg-[#292b31] dark:text-[#b7bbc5]"
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold leading-5">
                    {activity.title}
                  </h3>
                  {presentation.kind === "status" ? (
                    <div
                      className="mt-2 flex flex-wrap items-center gap-1.5"
                      aria-label={presentation.description}
                    >
                      <span aria-hidden="true">
                        <StatusBadge status={presentation.from} />
                      </span>
                      <span aria-hidden="true" className="text-xs text-[#8b909a]">
                        →
                      </span>
                      <span aria-hidden="true">
                        <StatusBadge status={presentation.to} />
                      </span>
                    </div>
                  ) : (
                    presentation.description && (
                      <p className="mt-1 text-xs leading-5 text-[#687080]">
                        {presentation.description}
                      </p>
                    )
                  )}
                  {presentation.kind === "text" && presentation.detail && (
                    <p className="mt-0.5 text-[11px] text-[#8b909a]">
                      {presentation.detail}
                    </p>
                  )}
                  <time
                    dateTime={activity.createdAt.toISOString()}
                    aria-label={`${relative}. ${exact}`}
                    className="mt-2 block"
                  >
                    <span className="block text-[11px] font-medium text-[#747b88]">
                      {relative}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-[#969ba5]">
                      {exact}
                    </span>
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="px-6 py-11 text-center">
          <p className="text-sm text-[#687080]">
            This lead has no recorded activity yet.
          </p>
          <p className="mt-1 text-xs text-[#969ba5]">
            New changes will appear here.
          </p>
        </div>
      )}
    </aside>
  );
}
