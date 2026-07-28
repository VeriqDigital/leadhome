import "server-only";

import { JobType, Prisma, type Job } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { isRevokedGrant } from "@/lib/gmail/gmail-client";
import { GmailProvider } from "@/lib/messaging/gmail-provider";
import {
  importProviderAccount,
  type ImportProgress,
} from "@/lib/messaging/import-service";
import { prisma } from "@/lib/prisma";
import {
  JobCancelledError,
  JobExecutionError,
  JobLeaseLostError,
} from "@/lib/jobs/errors";
import { heartbeatJob, withJobLease } from "@/lib/jobs/service";
import {
  gmailSyncJobPayloadSchema,
  gmailSyncJobResultSchema,
} from "@/lib/jobs/validation";
import type {
  GmailSyncJobProgress,
  GmailSyncJobResult,
} from "@/lib/jobs/types";
import {
  enqueueConversationAnalysisJob,
} from "@/lib/ai/conversation-analysis/job-service";
import { logJobEvent } from "@/lib/jobs/logging";

// Kept as a compatibility export for existing handler tests and callers.
export { JobLeaseLostError };

const PROGRESS_CHECKPOINT_INTERVAL_MS = 10_000;
const PROGRESS_CHECKPOINT_SIZE = 5;

function safeProviderStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return null;
  const response = "response" in error
    ? (error.response as { status?: unknown } | undefined)
    : undefined;
  return typeof response?.status === "number" ? response.status : null;
}

function safeErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}

export function classifyGmailSyncError(error: unknown) {
  if (error instanceof JobExecutionError) return error;
  if (isRevokedGrant(error)) {
    return new JobExecutionError(
      "GMAIL_RECONNECT_REQUIRED",
      "Google access was revoked. Reconnect Gmail.",
      false,
    );
  }

  const status = safeProviderStatus(error);
  if (status === 429) {
    return new JobExecutionError(
      "GMAIL_RATE_LIMITED",
      "Google temporarily limited Gmail access.",
      true,
    );
  }
  if (status !== null && status >= 500) {
    return new JobExecutionError(
      "GMAIL_PROVIDER_UNAVAILABLE",
      "Gmail is temporarily unavailable.",
      true,
    );
  }

  const code = safeErrorCode(error);
  if (
    code &&
    [
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "P1001",
      "P1002",
      "P1017",
    ].includes(code)
  ) {
    return new JobExecutionError(
      "TEMPORARY_SYNC_FAILURE",
      "Gmail synchronization was temporarily interrupted.",
      true,
    );
  }

  return new JobExecutionError(
    "TEMPORARY_SYNC_FAILURE",
    "Gmail synchronization could not finish because of a temporary problem.",
    true,
  );
}

function progressFromImport(progress: ImportProgress): GmailSyncJobProgress {
  const percent =
    progress.total === null
      ? undefined
      : progress.total === 0
        ? 100
        : Math.min(100, Math.round((progress.processed / progress.total) * 100));
  return {
    phase: progress.phase,
    processed: progress.processed,
    ...(progress.total === null ? {} : { total: progress.total }),
    ...(percent === undefined ? {} : { percent }),
    message: progress.message,
  };
}

async function assertLease(
  jobId: string,
  workerId: string,
  progress: GmailSyncJobProgress,
) {
  const lease = await heartbeatJob(jobId, workerId, progress);
  if (lease === "cancelled") throw new JobCancelledError();
  if (lease !== "ok") throw new JobLeaseLostError();
}

function assertDeadline(deadlineAt?: number) {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt - 1_000) {
    throw new JobExecutionError(
      "JOB_TIME_BUDGET_EXCEEDED",
      "Gmail synchronization reached this worker’s safe execution limit.",
      true,
    );
  }
}

function assertLeaseMutation(
  result: { kind: "ok" | "cancelled" | "lost" },
) {
  if (result.kind === "cancelled") throw new JobCancelledError();
  if (result.kind !== "ok") throw new JobLeaseLostError();
}

async function storeAccountFailure({
  jobId,
  workerId,
  ownerId,
  accountId,
  failure,
}: {
  jobId: string;
  workerId: string;
  ownerId: string;
  accountId: string;
  failure: JobExecutionError;
}) {
  const lease = await withJobLease(jobId, workerId, async (tx) =>
    tx.communicationAccount.updateMany({
      where: { id: accountId, ownerId, provider: "GMAIL" },
      data: {
        lastSyncError: failure.safeMessage,
        ...(failure.code === "GMAIL_RECONNECT_REQUIRED"
          ? { status: "RECONNECT_REQUIRED" as const }
          : {}),
      },
    }),
  );
  assertLeaseMutation(lease);
}

async function storeAccountSuccess({
  jobId,
  workerId,
  ownerId,
  accountId,
  summary,
  completedAt,
}: {
  jobId: string;
  workerId: string;
  ownerId: string;
  accountId: string;
  summary: {
    accountsProcessed: number;
    conversationsCreated: number;
    conversationsUpdated: number;
    messagesCreated: number;
    messagesSkipped: number;
    conversationsMatched: number;
    conversationsNeedingReview: number;
  };
  completedAt: Date;
}) {
  const lease = await withJobLease(jobId, workerId, async (tx) =>
    tx.communicationAccount.updateMany({
      where: { id: accountId, ownerId, provider: "GMAIL" },
      data: {
        lastImportedAt: completedAt,
        lastImportSummary: summary as Prisma.InputJsonValue,
        lastSyncError: null,
      },
    }),
  );
  assertLeaseMutation(lease);
}

export async function runGmailSyncJob(
  job: Job,
  {
    workerId,
    deadlineAt,
  }: {
    workerId: string;
    deadlineAt?: number;
  },
): Promise<GmailSyncJobResult> {
  const payload = gmailSyncJobPayloadSchema.safeParse(job.payload);
  if (!payload.success) {
    throw new JobExecutionError(
      "INVALID_JOB_PAYLOAD",
      "The Gmail sync request was invalid.",
      false,
    );
  }

  const startedAt = job.startedAt ?? new Date();
  let lastCheckpointAt = 0;
  let lastCheckpointProcessed = -1;
  let lastCheckpointPhase = "";
  const changedConversationIds = new Set<string>();

  try {
    assertDeadline(deadlineAt);
    await assertLease(job.id, workerId, {
      phase: "CONNECTING",
      processed: 0,
      message: "Connecting securely to Gmail.",
    });

    const account = await prisma.communicationAccount.findFirst({
      where: {
        id: payload.data.communicationAccountId,
        ownerId: job.ownerId,
        provider: "GMAIL",
      },
      select: {
        id: true,
        status: true,
        gmailCredential: { select: { id: true } },
      },
    });
    if (!account) {
      throw new JobExecutionError(
        "GMAIL_ACCOUNT_UNAVAILABLE",
        "The Gmail connection is no longer available.",
        false,
      );
    }
    if (
      account.status === "RECONNECT_REQUIRED" ||
      !account.gmailCredential
    ) {
      throw new JobExecutionError(
        "GMAIL_RECONNECT_REQUIRED",
        "Reconnect Gmail before synchronizing.",
        false,
      );
    }
    if (account.status !== "CONNECTED") {
      throw new JobExecutionError(
        "GMAIL_ACCOUNT_UNAVAILABLE",
        "The Gmail connection is no longer available.",
        false,
      );
    }

    const summary = await importProviderAccount({
      ownerId: job.ownerId,
      provider: new GmailProvider(
        account.id,
        job.ownerId,
        payload.data.threadLimit,
        deadlineAt,
      ),
      options: {
        persistAccountSummary: false,
        onConversationChanged(change) {
          changedConversationIds.add(change.conversationId);
        },
        async onProgress(importProgress) {
          assertDeadline(deadlineAt);
          const now = Date.now();
          const phaseChanged = importProgress.phase !== lastCheckpointPhase;
          const completedPhase =
            importProgress.total !== null &&
            importProgress.processed >= importProgress.total;
          const chunkReached =
            importProgress.processed - lastCheckpointProcessed >=
            PROGRESS_CHECKPOINT_SIZE;
          if (
            !phaseChanged &&
            !completedPhase &&
            !chunkReached &&
            now - lastCheckpointAt < PROGRESS_CHECKPOINT_INTERVAL_MS
          ) {
            return;
          }
          await assertLease(
            job.id,
            workerId,
            progressFromImport(importProgress),
          );
          lastCheckpointAt = now;
          lastCheckpointProcessed = importProgress.processed;
          lastCheckpointPhase = importProgress.phase;
        },
      },
    });

    assertDeadline(deadlineAt);
    const completedAt = new Date();
    const result = gmailSyncJobResultSchema.parse({
      ...summary,
      conversationsProcessed:
        summary.conversationsCreated + summary.conversationsUpdated,
      errors: [],
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });
    await assertLease(job.id, workerId, {
      phase: "FINALIZING",
      processed: result.conversationsProcessed,
      total: result.conversationsProcessed,
      percent: 100,
      message: "Gmail synchronization is ready to complete.",
    });
    let analysisQueued = 0;
    let analysisReused = 0;
    let analysisSkipped = 0;
    let analysisFailed = 0;
    for (const conversationId of changedConversationIds) {
      try {
        const analysis = await enqueueConversationAnalysisJob({
          ownerId: job.ownerId,
          conversationId,
          trigger: "GMAIL_IMPORT",
          force: false,
        });
        if (analysis.kind === "queued") analysisQueued++;
        else if (analysis.kind === "existing") analysisReused++;
        else analysisSkipped++;
      } catch {
        analysisFailed++;
      }
    }
    if (changedConversationIds.size) {
      logJobEvent("analysis_queued", {
        jobId: job.id,
        jobType: JobType.CONVERSATION_ANALYSIS,
        ownerId: job.ownerId,
        trigger: "GMAIL_IMPORT",
        queued: analysisQueued,
        reused: analysisReused,
        skipped: analysisSkipped,
        failed: analysisFailed,
      });
    }
    await storeAccountSuccess({
      jobId: job.id,
      workerId,
      ownerId: job.ownerId,
      accountId: account.id,
      summary,
      completedAt,
    });
    revalidatePath("/inbox");
    revalidatePath("/settings");
    revalidatePath("/");
    return result;
  } catch (error) {
    if (
      error instanceof JobCancelledError ||
      error instanceof JobLeaseLostError
    ) {
      throw error;
    }
    const failure = classifyGmailSyncError(error);
    await storeAccountFailure({
      jobId: job.id,
      workerId,
      ownerId: job.ownerId,
      accountId: payload.data.communicationAccountId,
      failure,
    });
    throw failure;
  }
}
