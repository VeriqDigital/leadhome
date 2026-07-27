import type { LeadStatus } from "@prisma/client";

export const ACTIVE_PIPELINE_STATUSES = [
  "NEW",
  "CONTACTED",
  "FOLLOW_UP",
  "PROPOSAL_SENT",
  "NEGOTIATING",
] as const satisfies readonly LeadStatus[];

export function startOfLocalWeek(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}
