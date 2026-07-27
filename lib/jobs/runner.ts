import "server-only";

import { JobType, type Job } from "@prisma/client";
import {
  ConversationAnalysisAttemptError,
  normalizeJobError,
  JobCancelledError,
  JobLeaseLostError,
} from "./errors";
import { runGmailSyncJob } from "./handlers/gmail-sync";
import { runConversationAnalysisJob } from "./handlers/conversation-analysis";
import {
  reconcileConversationAnalysisAfterCompletion,
  reconcileConversationAnalysisAfterTerminalFailure,
} from "@/lib/ai/conversation-analysis/job-service";
import { conversationAnalysisJobPayloadSchema } from "./validation";
import { logJobEvent } from "./logging";
import {
  claimNextJob,
  completeCancelledJob,
  completeJob,
  purgeExpiredJobs,
  recoverStaleJobs,
  retryJob,
} from "./service";
import type { JobResultByType } from "./types";

export type JobInvocationStats = {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  cancelled: number;
  leaseLost: number;
  staleRecovered: number;
  purged: number;
  stoppedForTimeBudget: boolean;
  durationMs: number;
};

async function dispatchJob(
  job: Job,
  workerId: string,
  deadlineAt: number,
): Promise<JobResultByType[JobType]> {
  switch (job.type) {
    case JobType.GMAIL_SYNC:
      return runGmailSyncJob(job, { workerId, deadlineAt });
    case JobType.CONVERSATION_ANALYSIS:
      return runConversationAnalysisJob(job, { workerId, deadlineAt });
  }
}

async function executeClaimedJob(
  job: Job,
  workerId: string,
  deadlineAt: number,
): Promise<
  "completed" | "retried" | "failed" | "cancelled" | "lease-lost"
> {
  logJobEvent("job_started", {
    jobId: job.id,
    jobType: job.type,
    ownerId: job.ownerId,
    workerId,
    attempt: job.attemptCount,
  });
  try {
    const result = await dispatchJob(job, workerId, deadlineAt);
    if (await completeJob(job.id, workerId, result, undefined, job.type)) {
      if (job.type === JobType.CONVERSATION_ANALYSIS) {
        const payload = conversationAnalysisJobPayloadSchema.safeParse(
          job.payload,
        );
        if (payload.success) {
          await reconcileConversationAnalysisAfterCompletion(
            job.ownerId,
            payload.data.conversationId,
          );
        }
      }
      return "completed";
    }
    return (await completeCancelledJob(job.id, workerId))
      ? "cancelled"
      : "lease-lost";
  } catch (error) {
    if (error instanceof JobCancelledError) {
      return (await completeCancelledJob(job.id, workerId))
        ? "cancelled"
        : "lease-lost";
    }
    if (error instanceof JobLeaseLostError) return "lease-lost";

    const retry = await retryJob(
      job.id,
      workerId,
      normalizeJobError(error),
    );
    if (retry.kind === "retry-scheduled") return "retried";
    if (retry.kind === "failed") {
      if (
        job.type === JobType.CONVERSATION_ANALYSIS &&
        error instanceof ConversationAnalysisAttemptError
      ) {
        await reconcileConversationAnalysisAfterTerminalFailure(
          job.ownerId,
          error.conversationId,
          error.attemptedContentHash,
        );
      }
      return "failed";
    }
    return (await completeCancelledJob(job.id, workerId))
      ? "cancelled"
      : "lease-lost";
  }
}

export async function runJobInvocation({
  workerId,
  maxJobs,
  timeBudgetMs,
  now = () => Date.now(),
}: {
  workerId: string;
  maxJobs: number;
  timeBudgetMs: number;
  now?: () => number;
}): Promise<JobInvocationStats> {
  const started = now();
  const boundedJobs = Math.max(1, Math.min(Math.floor(maxJobs), 25));
  const boundedBudget = Math.max(1_000, Math.min(timeBudgetMs, 55_000));
  const deadlineAt = started + boundedBudget;
  const reserveMs = Math.min(5_000, Math.floor(boundedBudget * 0.2));
  const stale = await recoverStaleJobs();
  const purged = await purgeExpiredJobs();
  const stats: JobInvocationStats = {
    claimed: 0,
    completed: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    leaseLost: 0,
    staleRecovered: stale.recovered,
    purged: purged.deleted,
    stoppedForTimeBudget: false,
    durationMs: 0,
  };

  while (stats.claimed < boundedJobs) {
    if (now() - started >= boundedBudget - reserveMs) {
      stats.stoppedForTimeBudget = true;
      break;
    }
    const job = await claimNextJob(workerId);
    if (!job) break;
    stats.claimed++;
    const outcome = await executeClaimedJob(job, workerId, deadlineAt);
    switch (outcome) {
      case "completed":
        stats.completed++;
        break;
      case "retried":
        stats.retried++;
        break;
      case "failed":
        stats.failed++;
        break;
      case "cancelled":
        stats.cancelled++;
        break;
      case "lease-lost":
        stats.leaseLost++;
        break;
    }
  }
  stats.durationMs = Math.max(0, now() - started);
  return stats;
}
