import "server-only";

import type { LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { statusLabels } from "@/lib/lead-format";
import { recordActivity } from "@/lib/activity-service";

const canonicalSelect = {
  id: true,
  name: true,
  status: true,
  updatedAt: true,
} satisfies Prisma.LeadSelect;

export type PipelineStatusLead = Prisma.LeadGetPayload<{
  select: typeof canonicalSelect;
}>;

export type LeadStatusMutation =
  | { kind: "changed"; lead: PipelineStatusLead; previousStatus: LeadStatus }
  | { kind: "unchanged"; lead: PipelineStatusLead }
  | { kind: "not-found" };

export async function changeLeadStatusInTransaction(
  tx: Prisma.TransactionClient,
  {
    ownerId,
    leadId,
    status,
    current,
    actorType = "USER",
    source = "MANUAL",
  }: {
    ownerId: string;
    leadId: string;
    status: LeadStatus;
    current?: { id: string; status: LeadStatus };
    actorType?: "USER" | "SYSTEM";
    source?: "MANUAL" | "GMAIL" | "INBOX" | "SYSTEM";
  },
): Promise<LeadStatusMutation> {
  const previous =
    current ??
    (await tx.lead.findFirst({
      where: { id: leadId, userId: ownerId },
      select: { id: true, status: true },
    }));
  if (!previous) return { kind: "not-found" };
  if (previous.status === status) {
    const canonical = await tx.lead.findFirst({
      where: { id: leadId, userId: ownerId },
      select: canonicalSelect,
    });
    return canonical
      ? { kind: "unchanged", lead: canonical }
      : { kind: "not-found" };
  }

  const updated = await tx.lead.updateMany({
    where: { id: leadId, userId: ownerId, status: previous.status },
    data: { status },
  });
  if (updated.count !== 1) return { kind: "not-found" };
  await recordActivity(tx, {
    ownerId,
    leadId,
    type: "STATUS_CHANGED",
    actorType,
    source,
    title: "Status changed",
    description: `${statusLabels[previous.status]} → ${statusLabels[status]}`,
    metadata: { from: previous.status, to: status },
  });
  const canonical = await tx.lead.findFirst({
    where: { id: leadId, userId: ownerId },
    select: canonicalSelect,
  });
  if (!canonical || canonical.status !== status) {
    throw new Error("Persisted lead status did not match the requested stage.");
  }
  return {
    kind: "changed",
    lead: canonical,
    previousStatus: previous.status,
  };
}

export async function advanceNewLeadToContactedInTransaction(
  tx: Prisma.TransactionClient,
  {
    ownerId,
    leadId,
    actorType = "SYSTEM",
    source = "SYSTEM",
  }: {
    ownerId: string;
    leadId: string;
    actorType?: "USER" | "SYSTEM";
    source?: "MANUAL" | "GMAIL" | "INBOX" | "SYSTEM";
  },
): Promise<LeadStatusMutation> {
  const current = await tx.lead.findFirst({
    where: { id: leadId, userId: ownerId },
    select: canonicalSelect,
  });
  if (!current) return { kind: "not-found" };
  if (current.status !== "NEW") return { kind: "unchanged", lead: current };
  return changeLeadStatusInTransaction(tx, {
    ownerId,
    leadId,
    status: "CONTACTED",
    current,
    actorType,
    source,
  });
}

export function moveLeadStatus(
  ownerId: string,
  leadId: string,
  status: LeadStatus,
) {
  return prisma.$transaction((tx) =>
    changeLeadStatusInTransaction(tx, { ownerId, leadId, status }),
  );
}

export async function reconcileContactedLeadStatuses(
  ownerId: string,
  limit = 100,
) {
  return prisma.$transaction(async (tx) => {
    const leads = await tx.lead.findMany({
      where: {
        userId: ownerId,
        status: "NEW",
        activities: {
          some: { userId: ownerId, type: "MESSAGE_SENT" },
        },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(Math.trunc(limit), 1), 500),
      select: { id: true },
    });
    let changed = 0;
    for (const lead of leads) {
      const result = await advanceNewLeadToContactedInTransaction(tx, {
        ownerId,
        leadId: lead.id,
        actorType: "SYSTEM",
        source: "SYSTEM",
      });
      if (result.kind === "changed") changed++;
    }
    return { changed, hasMore: leads.length === Math.min(Math.max(Math.trunc(limit), 1), 500) };
  });
}
