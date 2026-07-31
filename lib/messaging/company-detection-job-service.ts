import "server-only";

import { JobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  enqueueJobInTransaction,
  type EnqueueJobResult,
} from "@/lib/jobs/service";
import type { CompanyDetectionJobPayload } from "@/lib/jobs/types";
import { parseJobPayload } from "@/lib/jobs/validation";

export type EnqueueCompanyDetectionResult =
  | EnqueueJobResult
  | { kind: "not-found" };

export function companyDetectionIdempotencyKey(
  conversationId: string,
): string {
  return `gmail-import:${conversationId}`;
}

export async function enqueueCompanyDetectionJob({
  ownerId,
  conversationId,
}: {
  ownerId: string;
  conversationId: string;
}): Promise<EnqueueCompanyDetectionResult> {
  const payload = parseJobPayload(JobType.COMPANY_DETECTION, {
    conversationId,
    trigger: "GMAIL_IMPORT",
  } satisfies CompanyDetectionJobPayload);

  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: {
        id: payload.conversationId,
        ownerId,
        leadId: { not: null },
      },
      select: { id: true },
    });
    if (!conversation) return { kind: "not-found" as const };

    return enqueueJobInTransaction({
      ownerId,
      type: JobType.COMPANY_DETECTION,
      payload,
      idempotencyKey: companyDetectionIdempotencyKey(
        payload.conversationId,
      ),
    }, tx);
  });
}
