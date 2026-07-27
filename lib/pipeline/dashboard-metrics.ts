import "server-only";

import { prisma } from "@/lib/prisma";
import {
  ACTIVE_PIPELINE_STATUSES,
  startOfLocalWeek,
} from "@/lib/pipeline/metrics";

export async function getDashboardLeadMetrics(ownerId: string, now: Date) {
  const startOfWeek = startOfLocalWeek(now);
  const endOfToday = new Date(now);
  endOfToday.setHours(0, 0, 0, 0);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const [newCount, followUpCount, wonThisWeek, pipelineValue, grouped] =
    await Promise.all([
      prisma.lead.count({ where: { userId: ownerId, status: "NEW" } }),
      prisma.lead.count({
        where: {
          userId: ownerId,
          nextFollowUpDate: { lt: endOfToday },
        },
      }),
      prisma.lead.count({
        where: {
          userId: ownerId,
          status: "WON",
          updatedAt: { gte: startOfWeek },
        },
      }),
      prisma.lead.aggregate({
        where: {
          userId: ownerId,
          status: { in: [...ACTIVE_PIPELINE_STATUSES] },
        },
        _sum: { estimatedValue: true },
      }),
      prisma.lead.groupBy({
        by: ["status"],
        where: { userId: ownerId },
        _count: true,
      }),
    ]);
  return {
    newCount,
    followUpCount,
    wonThisWeek,
    pipelineValue,
    grouped,
  };
}
