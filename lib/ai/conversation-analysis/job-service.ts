import "server-only";

import {
  JobStatus,
  JobType,
  Prisma,
} from "@prisma/client";
import { getConversationAnalysisConfig } from "@/lib/ai/config";
import {
  loadConversationAnalysisSource,
  prepareConversationInput,
} from "./prepare-input";
import { prisma } from "@/lib/prisma";
import {
  ACTIVE_JOB_STATUSES,
  type ConversationAnalysisTrigger,
  type EnqueueConversationAnalysisResult,
} from "@/lib/jobs/types";
import {
  enqueueJobInTransaction,
  serializeConversationAnalysisJob,
} from "@/lib/jobs/service";
import { logJobEvent } from "@/lib/jobs/logging";

async function acquirePreferenceMutex(
  tx: Prisma.TransactionClient,
  ownerId: string,
) {
  const key = `conversation-intelligence:${ownerId}`;
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))
  `);
}

function isUniqueRace(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function findActiveAnalysisJob(
  ownerId: string,
  conversationId: string,
) {
  return prisma.job.findFirst({
    where: {
      ownerId,
      type: JobType.CONVERSATION_ANALYSIS,
      idempotencyKey: conversationId,
      status: { in: [...ACTIVE_JOB_STATUSES] },
    },
  });
}

export async function enqueueConversationAnalysisJob({
  ownerId,
  conversationId,
  trigger,
  force = trigger === "MANUAL_REANALYSIS",
}: {
  ownerId: string;
  conversationId: string;
  trigger: ConversationAnalysisTrigger;
  force?: boolean;
}): Promise<EnqueueConversationAnalysisResult> {
  const config = getConversationAnalysisConfig();
  const source = await loadConversationAnalysisSource(ownerId, conversationId);
  if (!source) return { kind: "not-found" };
  const prepared = prepareConversationInput({
    source,
    analysisVersion: config.analysisVersion,
    maxInputChars: config.maxInputChars,
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await acquirePreferenceMutex(tx, ownerId);
      const [user, conversation, active, current] = await Promise.all([
        tx.user.findUnique({
          where: { id: ownerId },
          select: { conversationIntelligenceEnabled: true },
        }),
        tx.conversation.findFirst({
          where: { id: conversationId, ownerId },
          select: { id: true, leadId: true },
        }),
        tx.job.findFirst({
          where: {
            ownerId,
            type: JobType.CONVERSATION_ANALYSIS,
            idempotencyKey: conversationId,
            status: { in: [...ACTIVE_JOB_STATUSES] },
          },
        }),
        tx.conversationAnalysis.findUnique({
          where: {
            conversationId_ownerId: { conversationId, ownerId },
          },
        }),
      ]);
      if (!user?.conversationIntelligenceEnabled) {
        return { kind: "disabled" as const };
      }
      if (!conversation) return { kind: "not-found" as const };
      if (active) return { kind: "existing" as const, job: active };
      if (trigger !== "MANUAL_REANALYSIS" && !conversation.leadId) {
        return { kind: "unlinked" as const };
      }
      if (!prepared.hasMeaningfulContent) {
        const preserveCompletedOutput = Boolean(
          current?.completedAt && current.structuredData,
        );
        await tx.conversationAnalysis.upsert({
          where: {
            conversationId_ownerId: { conversationId, ownerId },
          },
          create: {
            ownerId,
            conversationId,
            status: "SKIPPED",
            contentHash: prepared.contentHash,
            analysisVersion: config.analysisVersion,
            sourceMessageCount: prepared.sourceMessageCount,
            inputTruncated: prepared.inputTruncated,
            lastErrorCode: "AI_NO_CONTENT",
            lastErrorMessage:
              "This conversation does not contain analyzable message text.",
          },
          update: {
            status: "SKIPPED",
            ...(preserveCompletedOutput
              ? {}
              : {
                  contentHash: prepared.contentHash,
                  analysisVersion: config.analysisVersion,
                  sourceMessageCount: prepared.sourceMessageCount,
                  inputTruncated: prepared.inputTruncated,
                }),
            lastErrorCode: "AI_NO_CONTENT",
            lastErrorMessage:
              "This conversation does not contain analyzable message text.",
          },
        });
        return { kind: "no-content" as const };
      }
      if (
        !force &&
        current?.status === "COMPLETED" &&
        current.contentHash === prepared.contentHash &&
        current.analysisVersion === config.analysisVersion
      ) {
        return { kind: "unchanged" as const };
      }

      const enqueued = await enqueueJobInTransaction({
        ownerId,
        type: JobType.CONVERSATION_ANALYSIS,
        payload: {
          conversationId,
          trigger,
          force,
          analysisVersion: config.analysisVersion,
        },
        idempotencyKey: conversationId,
      }, tx);
      if (enqueued.kind === "queued") {
        await tx.conversationAnalysis.upsert({
          where: {
            conversationId_ownerId: { conversationId, ownerId },
          },
          create: {
            ownerId,
            conversationId,
            latestJobId: enqueued.job.id,
            status: "QUEUED",
            contentHash: prepared.contentHash,
            analysisVersion: config.analysisVersion,
            sourceMessageCount: prepared.sourceMessageCount,
            inputTruncated: prepared.inputTruncated,
            queuedAt: enqueued.job.createdAt,
          },
          update: {
            latestJobId: enqueued.job.id,
            status: "QUEUED",
            queuedAt: enqueued.job.createdAt,
            startedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
      }
      return enqueued;
    });

    if (result.kind === "queued") {
      logJobEvent("analysis_queued", {
        jobId: result.job.id,
        jobType: JobType.CONVERSATION_ANALYSIS,
        ownerId,
        trigger,
      });
      return {
        kind: "queued",
        job: serializeConversationAnalysisJob(result.job),
      };
    }
    if (result.kind === "existing") {
      logJobEvent("analysis_job_reused", {
        jobId: result.job.id,
        jobType: JobType.CONVERSATION_ANALYSIS,
        ownerId,
        trigger,
      });
      return {
        kind: "existing",
        job: serializeConversationAnalysisJob(result.job),
      };
    }
    if (result.kind === "unchanged") {
      logJobEvent("analysis_unchanged_skipped", {
        jobType: JobType.CONVERSATION_ANALYSIS,
        ownerId,
        trigger,
      });
    }
    return result;
  } catch (error) {
    if (!isUniqueRace(error)) throw error;
    const existing = await findActiveAnalysisJob(ownerId, conversationId);
    if (!existing) throw error;
    logJobEvent("analysis_job_reused", {
      jobId: existing.id,
      jobType: JobType.CONVERSATION_ANALYSIS,
      ownerId,
      trigger,
    });
    return {
      kind: "existing",
      job: serializeConversationAnalysisJob(existing),
    };
  }
}

export async function enqueueConversationAnalysisAfterLeadLink(
  ownerId: string,
  conversationId: string,
) {
  try {
    await enqueueConversationAnalysisJob({
      ownerId,
      conversationId,
      trigger: "LEAD_LINKED",
      force: false,
    });
  } catch {
    logJobEvent("analysis_enqueue_failed", {
      jobType: JobType.CONVERSATION_ANALYSIS,
      ownerId,
      trigger: "LEAD_LINKED",
      failed: 1,
    });
  }
}

export async function reconcileConversationAnalysisAfterCompletion(
  ownerId: string,
  conversationId: string,
) {
  try {
    return await enqueueConversationAnalysisJob({
      ownerId,
      conversationId,
      trigger: "GMAIL_IMPORT",
      force: false,
    });
  } catch {
    logJobEvent("analysis_enqueue_failed", {
      jobType: JobType.CONVERSATION_ANALYSIS,
      ownerId,
      trigger: "GMAIL_IMPORT",
      failed: 1,
    });
    return null;
  }
}

export async function reconcileConversationAnalysisAfterTerminalFailure(
  ownerId: string,
  conversationId: string,
  attemptedContentHash: string,
) {
  try {
    const config = getConversationAnalysisConfig();
    const source = await loadConversationAnalysisSource(
      ownerId,
      conversationId,
    );
    if (!source) return null;
    const current = prepareConversationInput({
      source,
      analysisVersion: config.analysisVersion,
      maxInputChars: config.maxInputChars,
    });
    if (current.contentHash === attemptedContentHash) {
      return { kind: "unchanged" as const };
    }
    return await enqueueConversationAnalysisJob({
      ownerId,
      conversationId,
      trigger: "GMAIL_IMPORT",
      force: false,
    });
  } catch {
    logJobEvent("analysis_enqueue_failed", {
      jobType: JobType.CONVERSATION_ANALYSIS,
      ownerId,
      trigger: "GMAIL_IMPORT",
      failed: 1,
    });
    return null;
  }
}

export async function setConversationIntelligencePreference(
  ownerId: string,
  enabled: boolean,
  now = new Date(),
) {
  const result = await prisma.$transaction(async (tx) => {
    await acquirePreferenceMutex(tx, ownerId);
    const updated = await tx.user.updateMany({
      where: { id: ownerId },
      data: { conversationIntelligenceEnabled: enabled },
    });
    if (updated.count !== 1) return null;
    if (enabled) {
      return { enabled: true, cancelled: 0, cancellationRequested: 0 };
    }
    const cancelled = await tx.$queryRaw<
      Array<{ id: string; previousStatus: JobStatus }>
    >(Prisma.sql`
      WITH "active" AS (
        SELECT "id", "status"
        FROM "Job"
        WHERE "ownerId" = ${ownerId}
          AND "type" = 'CONVERSATION_ANALYSIS'::"JobType"
          AND "status" IN (
            'PENDING'::"JobStatus",
            'RUNNING'::"JobStatus",
            'RETRY_SCHEDULED'::"JobStatus"
          )
        FOR UPDATE
      )
      UPDATE "Job" AS job
      SET
        "status" = 'CANCELLED'::"JobStatus",
        "completedAt" = ${now},
        "lastErrorCode" = 'AI_PREFERENCE_DISABLED',
        "lastErrorMessage" = 'Conversation Intelligence was disabled.',
        "idempotencyKey" = NULL,
        "updatedAt" = ${now}
      FROM "active"
      WHERE job."id" = "active"."id"
      RETURNING job."id", "active"."status" AS "previousStatus"
    `);
    if (cancelled.length) {
      await tx.conversationAnalysis.updateMany({
        where: {
          ownerId,
          latestJobId: { in: cancelled.map((job) => job.id) },
        },
        data: {
          status: "CANCELLED",
          lastErrorCode: "AI_PREFERENCE_DISABLED",
          lastErrorMessage: "Conversation Intelligence was disabled.",
        },
      });
    }
    return {
      enabled: false,
      cancelled: cancelled.filter(
        (job) => job.previousStatus !== JobStatus.RUNNING,
      ).length,
      cancellationRequested: cancelled.filter(
        (job) => job.previousStatus === JobStatus.RUNNING,
      ).length,
    };
  });
  if (!result) throw new Error("User preference could not be updated.");
  if (!enabled && (result.cancelled || result.cancellationRequested)) {
    logJobEvent("analysis_cancelled", {
      jobType: JobType.CONVERSATION_ANALYSIS,
      ownerId,
      count: result.cancelled + result.cancellationRequested,
    });
  }
  return result;
}

export async function latestSuccessfulConversationAnalysisAt(ownerId: string) {
  const analysis = await prisma.conversationAnalysis.findFirst({
    where: { ownerId, completedAt: { not: null } },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    select: { completedAt: true },
  });
  return analysis?.completedAt ?? null;
}
