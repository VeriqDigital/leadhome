import "server-only";
import type { LeadActivityType, LeadSource, LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  formatCurrency,
  formatDate,
  sourceLabels,
  statusLabels,
} from "@/lib/lead-format";

type TrackedLead = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: LeadSource;
  status: LeadStatus;
  message: string | null;
  estimatedValue: Prisma.Decimal | number | null;
  nextFollowUpDate: Date | null;
};

export type ActivityCreate = {
  type: LeadActivityType;
  title: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
};

const value = (input: string | null) => input || "Not set";
const iso = (input: Date | null) => input?.toISOString() ?? null;

export function buildLeadUpdateActivities(
  previous: TrackedLead,
  next: TrackedLead,
): ActivityCreate[] {
  const activities: ActivityCreate[] = [];
  if (previous.status !== next.status) {
    activities.push({
      type: "STATUS_CHANGED",
      title: "Status changed",
      description: `${statusLabels[previous.status]} → ${statusLabels[next.status]}`,
      metadata: { from: previous.status, to: next.status },
    });
  }
  const previousValue = previous.estimatedValue === null ? null : Number(previous.estimatedValue);
  const nextValue = next.estimatedValue === null ? null : Number(next.estimatedValue);
  if (previousValue !== nextValue) {
    activities.push({
      type: "ESTIMATED_VALUE_CHANGED",
      title: "Estimated value updated",
      description: `${formatCurrency(previousValue)} → ${formatCurrency(nextValue)}`,
      metadata: { from: previousValue, to: nextValue },
    });
  }
  if (iso(previous.nextFollowUpDate) !== iso(next.nextFollowUpDate)) {
    const title = !next.nextFollowUpDate
      ? "Follow-up cleared"
      : previous.nextFollowUpDate
        ? "Follow-up rescheduled"
        : "Follow-up scheduled";
    activities.push({
      type: "FOLLOW_UP_CHANGED",
      title,
      description: `${formatDate(previous.nextFollowUpDate)} → ${formatDate(next.nextFollowUpDate)}`,
      metadata: { from: iso(previous.nextFollowUpDate), to: iso(next.nextFollowUpDate) },
    });
  }
  const contactChanges = Object.fromEntries(
    (["name", "email", "phone"] as const)
      .filter((field) => previous[field] !== next[field])
      .map((field) => [field, { from: previous[field], to: next[field] }]),
  );
  if (Object.keys(contactChanges).length) {
    activities.push({
      type: "CONTACT_INFO_CHANGED",
      title: "Contact information updated",
      metadata: contactChanges,
    });
  }
  if (previous.company !== next.company) {
    activities.push({
      type: "COMPANY_CHANGED",
      title: "Company updated",
      description: `${value(previous.company)} → ${value(next.company)}`,
      metadata: { from: previous.company, to: next.company },
    });
  }
  if (previous.message !== next.message) {
    activities.push({
      type: "NOTES_CHANGED",
      title: "Notes updated",
      description: "Lead notes were changed.",
      metadata: {
        previousLength: previous.message?.length ?? 0,
        nextLength: next.message?.length ?? 0,
      },
    });
  }
  if (previous.source !== next.source) {
    activities.push({
      type: "SOURCE_CHANGED",
      title: "Source updated",
      description: `${sourceLabels[previous.source]} → ${sourceLabels[next.source]}`,
      metadata: { from: previous.source, to: next.source },
    });
  }
  return activities;
}

export async function getLeadActivitiesForUser({
  leadId,
  userId,
  limit = 50,
}: {
  leadId: string;
  userId: string;
  limit?: number;
}) {
  return prisma.leadActivity.findMany({
    where: { leadId, userId, lead: { userId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      type: true,
      title: true,
      description: true,
      createdAt: true,
    },
  });
}
