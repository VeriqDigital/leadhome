import "server-only";

import {
  formatCurrency,
  formatDateOnly,
  formatDateTime,
  formatRelativeTime,
  isLeadSource,
  isLeadStatus,
  sourceLabels,
  statusLabels,
} from "@/lib/lead-format";

export type TimelineActivity = {
  id: string;
  type: string;
  actorType?: string;
  source?: string;
  title: string;
  description: string | null;
  metadata?: unknown;
  occurredAt?: Date | string;
  createdAt?: Date | string;
  lead?: { id: string; name: string } | null;
  conversation?: { id: string; subject: string | null } | null;
  task?: { id: string; title: string } | null;
};

export type ActivityPresentation =
  | { kind: "status"; from: string; to: string; description: string }
  | { kind: "text"; description: string | null; detail?: string };

export type ActivityRelatedDisplay =
  | { kind: "link"; href: string; label: string }
  | { kind: "missing"; label: string };

export type ActivityDisplayItem = {
  id: string;
  type: string;
  glyph: string;
  title: string;
  presentation: ActivityPresentation;
  context: string | null;
  occurredAt: string;
  relativeTime: string;
  exactTime: string;
  dayKey: string;
  dayLabel: string;
  related: ActivityRelatedDisplay | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function has(object: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function status(value: unknown) {
  return isLeadStatus(value) ? statusLabels[value] : null;
}

function source(value: unknown) {
  return isLeadSource(value) ? sourceLabels[value] : null;
}

function money(value: unknown) {
  if (value === null) return "No value";
  if ((typeof value === "number" || typeof value === "string") && value !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatCurrency(parsed) : null;
  }
  return null;
}

export function activityPresentation(
  activity: TimelineActivity,
): ActivityPresentation {
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
    if (from && to) return { kind: "text", description: `${from} → ${to}` };
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
      return { kind: "text", description: `${summary} updated` };
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
    return {
      kind: "text",
      description: activity.description,
      detail:
        typeof previous === "number" && typeof next === "number"
          ? `${previous} → ${next} characters`
          : undefined,
    };
  }
  if (
    activity.type === "SOURCE_CHANGED" &&
    has(metadata, "from") &&
    has(metadata, "to")
  ) {
    const from = source(metadata.from);
    const to = source(metadata.to);
    if (from && to) return { kind: "text", description: `${from} → ${to}` };
  }
  return { kind: "text", description: activity.description };
}

function activityDate(activity: TimelineActivity) {
  const value = activity.occurredAt ?? activity.createdAt;
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function calendarDay(date: Date, timeZone: string) {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date)) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      values[part.type] = Number(part.value);
    }
  }
  const year = values.year!;
  const month = values.month!;
  const day = values.day!;
  return {
    key: `${year}-${month}-${day}`,
    serial: Date.UTC(year, month - 1, day) / 86_400_000,
  };
}

function dayLabel(date: Date, now: Date, timeZone: string) {
  const difference =
    calendarDay(now, timeZone).serial - calendarDay(date, timeZone).serial;
  if (difference === 0) return "Today";
  if (difference === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(date);
}

const sourceNames: Record<string, string> = {
  WEBSITE: "Website",
  GMAIL: "Gmail",
  INBOX: "Inbox",
  TASK: "Tasks",
  AI: "Conversation Intelligence",
  SYSTEM: "LeadHome",
};

const actorNames: Record<string, string> = {
  CONTACT: "Contact",
  SYSTEM: "LeadHome",
  AI: "AI",
};

const glyphs: Record<string, string> = {
  LEAD_CREATED: "+",
  WEBSITE_SUBMISSION_RECEIVED: "W",
  CONVERSATION_IMPORTED: "I",
  STATUS_CHANGED: "=",
  ESTIMATED_VALUE_CHANGED: "$",
  FOLLOW_UP_CHANGED: "@",
  CONTACT_INFO_CHANGED: "C",
  COMPANY_CHANGED: "B",
  NOTES_CHANGED: "N",
  SOURCE_CHANGED: "S",
  MESSAGE_RECEIVED: "<",
  MESSAGE_SENT: ">",
  CONVERSATION_LINKED: "+",
  CONVERSATION_UNLINKED: "-",
  CONVERSATION_STATUS_CHANGED: "M",
  AI_ANALYSIS_COMPLETED: "AI",
  TASK_CREATED: "+",
  TASK_UPDATED: "E",
  TASK_COMPLETED: "OK",
  TASK_REOPENED: "R",
  TASK_CANCELLED: "X",
  TASK_DELETED: "-",
};

function relatedDisplay(
  activity: TimelineActivity,
): ActivityRelatedDisplay | null {
  if (activity.type.startsWith("TASK_") && activity.task) {
    return {
      kind: "link",
      href: `/tasks/${encodeURIComponent(activity.task.id)}/edit`,
      label: "Open task",
    };
  }
  if (activity.conversation) {
    return {
      kind: "link",
      href: `/inbox?conversation=${encodeURIComponent(activity.conversation.id)}`,
      label: "Open conversation",
    };
  }
  if (activity.task) {
    return {
      kind: "link",
      href: `/tasks/${encodeURIComponent(activity.task.id)}/edit`,
      label: "Open task",
    };
  }
  if (activity.type.startsWith("TASK_")) {
    return { kind: "missing", label: "Related task is no longer available." };
  }
  if (
    activity.type.startsWith("CONVERSATION_") ||
    activity.type.startsWith("MESSAGE_") ||
    activity.type.startsWith("AI_")
  ) {
    return {
      kind: "missing",
      label: "Related conversation is no longer available.",
    };
  }
  return null;
}

export function isSupportedTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function presentActivities({
  activities,
  now,
  timeZone,
}: {
  activities: TimelineActivity[];
  now: Date | string;
  timeZone: string;
}): ActivityDisplayItem[] {
  const currentTime = now instanceof Date ? now : new Date(now);
  const stableNow = Number.isFinite(currentTime.getTime())
    ? currentTime
    : new Date(0);
  const stableTimeZone = isSupportedTimeZone(timeZone) ? timeZone : "UTC";

  return activities.map((activity) => {
    const occurredAt = activityDate(activity);
    const day = calendarDay(occurredAt, stableTimeZone);
    const sourceText = activity.source ? sourceNames[activity.source] : null;
    const actorText = activity.actorType
      ? actorNames[activity.actorType]
      : null;
    return {
      id: activity.id,
      type: activity.type,
      glyph: glyphs[activity.type] ?? "·",
      title: activity.title,
      presentation: activityPresentation(activity),
      context: [sourceText, actorText].filter(Boolean).join(" · ") || null,
      occurredAt: occurredAt.toISOString(),
      relativeTime: formatRelativeTime(occurredAt, stableNow),
      exactTime: formatDateTime(occurredAt, stableTimeZone),
      dayKey: day.key,
      dayLabel: dayLabel(occurredAt, stableNow, stableTimeZone),
      related: relatedDisplay(activity),
    };
  });
}
