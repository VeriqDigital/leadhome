import "server-only";

import type { LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { statusLabels } from "@/lib/lead-format";

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
  }: {
    ownerId: string;
    leadId: string;
    status: LeadStatus;
    current?: { id: string; status: LeadStatus };
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
  await tx.leadActivity.create({
    data: {
      leadId,
      userId: ownerId,
      type: "STATUS_CHANGED",
      title: "Status changed",
      description: `${statusLabels[previous.status]} → ${statusLabels[status]}`,
      metadata: { from: previous.status, to: status },
    },
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

export function moveLeadStatus(
  ownerId: string,
  leadId: string,
  status: LeadStatus,
) {
  return prisma.$transaction((tx) =>
    changeLeadStatusInTransaction(tx, { ownerId, leadId, status }),
  );
}
