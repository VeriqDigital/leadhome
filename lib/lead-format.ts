import type { LeadSource, LeadStatus } from "@prisma/client";

export const statusValues = [
  "NEW",
  "CONTACTED",
  "FOLLOW_UP",
  "PROPOSAL_SENT",
  "NEGOTIATING",
  "WON",
  "LOST",
] as const satisfies readonly LeadStatus[];

export const sourceValues = [
  "MANUAL",
  "WEBSITE",
  "GMAIL",
  "FACEBOOK",
  "PHONE",
] as const satisfies readonly LeadSource[];

export const statusLabels: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  FOLLOW_UP: "Follow-up",
  PROPOSAL_SENT: "Proposal sent",
  NEGOTIATING: "Negotiating",
  WON: "Won",
  LOST: "Lost",
};

export const sourceLabels: Record<LeadSource, string> = {
  MANUAL: "Manual",
  WEBSITE: "Website",
  GMAIL: "Gmail",
  FACEBOOK: "Facebook",
  PHONE: "Phone",
};

export function isLeadStatus(value: unknown): value is LeadStatus {
  return (
    typeof value === "string" &&
    statusValues.some((status) => status === value)
  );
}

export function isLeadSource(value: unknown): value is LeadSource {
  return (
    typeof value === "string" &&
    sourceValues.some((source) => source === value)
  );
}

export function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "No value";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "No value";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(value: Date | null | undefined) {
  return value && Number.isFinite(value.getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value)
    : "No date";
}

export function formatDateOnly(value: unknown) {
  if (!value) return "No date";
  const normalized =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "string"
        ? value
        : "";
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})/,
  );
  if (!match) return "No date";
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function formatDateTime(value: Date) {
  if (!Number.isFinite(value.getTime())) return "Unknown time";
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
  return `${date} · ${time}`;
}

export function formatRelativeTime(value: Date, now = new Date()) {
  if (!Number.isFinite(value.getTime()) || !Number.isFinite(now.getTime())) {
    return "Unknown time";
  }
  const seconds = Math.round((value.getTime() - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}
