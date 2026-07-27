import "server-only";

import {
  JobStatus,
  JobType,
  Prisma,
  type Job,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getJobConfig } from "./config";
import { JobExecutionError, normalizeJobError } from "./errors";
import { logJobEvent } from "./logging";
import {
  ACTIVE_JOB_STATUSES,
  type EnqueueGmailSyncResult,
  type GmailSyncJobProgress,
  type GmailSyncJobResult,
  type GmailSyncJobView,
  type HeartbeatResult,
  type JobPayloadByType,
  type RetryJobResult,
  isActiveJobStatus,
} from "./types";
import {
  gmailSyncJobProgressSchema,
  gmailSyncJobResultSchema,
  parseJobPayload,
  parseJobProgress,
  parseJobResult,
} from "./validation";

const SECOND_MS = 1_000;
const DAY_MS = 24 * 60 * 60 * SECOND_MS;
const COMPLETED_RETENTION_MS = 30 * DAY_MS;
const FAILED_RETENTION_MS = 90 * DAY_MS;
const MAX_SERVICE_LIMIT = 100;

type EnqueueJobInput<T extends JobType> = {
  ownerId: string;
  type: T;
  payload: JobPayloadByType[T];
  idempotencyKey?: string | null;
  maxAttempts?: number;
  availableAt?: Date;
};

export type EnqueueJobResult = {
  kind: "queued" | "existing";
  job: Job;
};

export type CancelJobResult = {
  kind: "cancelled" | "not-found";
};

export type DisconnectGmailAccountResult =
  | { kind: "not-found" }
  | {
      kind: "disconnected";
      encryptedRefreshToken: string | null;
      cancelled: number;
      cancellationRequested: number;
    };

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function boundedLimit(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(1, Math.min(value!, MAX_SERVICE_LIMIT));
}

function validWorkerId(workerId: string): string {
  const normalized = workerId.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new Error("Worker identifiers must contain 8 to 200 characters.");
  }
  return normalized;
}

export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const bases = [30_000, 120_000, 600_000];
  let base = bases[Math.min(normalizedAttempt - 1, bases.length - 1)];
  if (normalizedAttempt > bases.length) {
    base = Math.min(
      base * 2 ** (normalizedAttempt - bases.length),
      60 * 60 * SECOND_MS,
    );
  }
  const randomValue = Math.max(0, Math.min(random(), 1));
  return Math.round(base * (0.8 + randomValue * 0.4));
}

async function acquireGmailMailboxMutex(
  tx: Prisma.TransactionClient,
  ownerId: string,
  accountId: string,
) {
  const mutexKey = `gmail-mailbox:${ownerId}:${accountId}`;
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${mutexKey}, 0::bigint)
    )
  `);
}

async function enqueueJob<T extends JobType>(
  input: EnqueueJobInput<T>,
  client: Pick<Prisma.TransactionClient, "job">,
): Promise<EnqueueJobResult> {
  const payload = parseJobPayload(input.type, input.payload);
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (input.type === JobType.GMAIL_SYNC && !idempotencyKey) {
    throw new Error("Gmail sync jobs require an active idempotency key.");
  }
  const configuredMaxAttempts = getJobConfig().maxAttempts;
  const maxAttempts = Math.max(
    1,
    Math.min(input.maxAttempts ?? configuredMaxAttempts, 10),
  );
  const existing = await client.job.findFirst({
    where: {
      ownerId: input.ownerId,
      type: input.type,
      idempotencyKey,
      status: { in: [...ACTIVE_JOB_STATUSES] },
    },
  });
  if (existing) return { kind: "existing", job: existing };

  const job = await client.job.create({
    data: {
      ownerId: input.ownerId,
      type: input.type,
      payload: inputJson(payload),
      progress: inputJson({
        phase: "QUEUED",
        processed: 0,
        message: "Sync queued.",
      } satisfies GmailSyncJobProgress),
      idempotencyKey,
      maxAttempts,
      availableAt: input.availableAt ?? new Date(),
    },
  });
  logJobEvent("job_queued", {
    jobId: job.id,
    jobType: job.type,
    ownerId: job.ownerId,
  });
  return { kind: "queued", job };
}

export async function enqueueGmailSyncJob(
  ownerId: string,
  accountId: string,
): Promise<EnqueueGmailSyncResult> {
  const payload = parseJobPayload(JobType.GMAIL_SYNC, {
    communicationAccountId: accountId,
    requestedBy: "USER",
    threadLimit: getJobConfig().gmailThreadLimit,
    trigger: "MANUAL",
  });
  const result = await prisma.$transaction(async (tx) => {
    // Enqueue and disconnect serialize on this mailbox mutex. The account read
    // deliberately does not take a row lock: worker finalization always locks
    // Job before CommunicationAccount, so keeping enqueue/disconnect in that
    // same order avoids a Job/account lock-order inversion.
    await acquireGmailMailboxMutex(
      tx,
      ownerId,
      payload.communicationAccountId,
    );
    const account = await tx.communicationAccount.findFirst({
      where: {
        id: payload.communicationAccountId,
        ownerId,
        provider: "GMAIL",
        status: "CONNECTED",
      },
      select: { id: true },
    });
    if (!account) return null;
    return enqueueJob({
      ownerId,
      type: JobType.GMAIL_SYNC,
      payload,
      // This field is an active lease key. Terminal transitions clear it so a
      // later manual sync can create a fresh job.
      idempotencyKey: account.id,
    }, tx);
  });
  if (!result) return { kind: "not-found" };
  return {
    kind: result.kind,
    job: serializeGmailSyncJob(result.job),
  };
}

export function serializeGmailSyncJob(job: Job): GmailSyncJobView {
  if (job.type !== JobType.GMAIL_SYNC) {
    throw new Error(`Cannot serialize ${job.type} as a Gmail sync job.`);
  }
  const payload = parseJobPayload(JobType.GMAIL_SYNC, job.payload);
  const progress = job.progress
    ? gmailSyncJobProgressSchema.safeParse(job.progress)
    : null;
  const result = job.result
    ? gmailSyncJobResultSchema.safeParse(job.result)
    : null;
  return {
    id: job.id,
    communicationAccountId: payload.communicationAccountId,
    type: "GMAIL_SYNC",
    status: job.status,
    progress: progress?.success ? progress.data : null,
    result: result?.success ? result.data : null,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    availableAt: job.availableAt.toISOString(),
    queuedAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    failedAt: job.failedAt?.toISOString() ?? null,
    lastErrorCode: job.lastErrorCode,
    lastErrorMessage: job.lastErrorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    active: isActiveJobStatus(job.status),
  };
}

export async function getJob(
  ownerId: string,
  jobId: string,
): Promise<Job | null> {
  return prisma.job.findFirst({
    where: { id: jobId, ownerId },
  });
}

export async function listRecentJobs(
  ownerId: string,
  options: { type?: typeof JobType.GMAIL_SYNC; limit?: number } = {},
): Promise<GmailSyncJobView[]> {
  const jobs = await prisma.job.findMany({
    where: {
      ownerId,
      type: options.type ?? JobType.GMAIL_SYNC,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: boundedLimit(options.limit, 10),
  });
  return jobs.map(serializeGmailSyncJob);
}

export async function getLatestGmailSyncJob(
  ownerId: string,
  accountId: string,
): Promise<GmailSyncJobView | null> {
  const job = await prisma.job.findFirst({
    where: {
      ownerId,
      type: JobType.GMAIL_SYNC,
      payload: {
        path: ["communicationAccountId"],
        equals: accountId,
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return job ? serializeGmailSyncJob(job) : null;
}

export async function claimNextJob(
  workerId: string,
  now: Date = new Date(),
): Promise<Job | null> {
  const lockOwner = validWorkerId(workerId);
  const claimed = await prisma.$queryRaw<Job[]>(Prisma.sql`
    WITH "candidate" AS (
      SELECT "id"
      FROM "Job"
      WHERE "status" IN (
        'PENDING'::"JobStatus",
        'RETRY_SCHEDULED'::"JobStatus"
      )
        AND "availableAt" <= ${now}
        AND "lockedAt" IS NULL
        AND "attemptCount" < "maxAttempts"
      ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "Job" AS job
    SET
      "status" = 'RUNNING'::"JobStatus",
      "lockedAt" = ${now},
      "lockedBy" = ${lockOwner},
      "heartbeatAt" = ${now},
      "startedAt" = COALESCE(job."startedAt", ${now}),
      "attemptCount" = job."attemptCount" + 1,
      "updatedAt" = ${now}
    FROM "candidate"
    WHERE job."id" = "candidate"."id"
    RETURNING job.*
  `);
  const job = claimed[0] ?? null;
  if (job) {
    logJobEvent("job_claimed", {
      jobId: job.id,
      jobType: job.type,
      ownerId: job.ownerId,
      workerId: lockOwner,
      attempt: job.attemptCount,
    });
  }
  return job;
}

export async function heartbeatJob(
  jobId: string,
  workerId: string,
  progress?: GmailSyncJobProgress,
  now: Date = new Date(),
): Promise<HeartbeatResult> {
  const lockOwner = validWorkerId(workerId);
  const parsedProgress = progress ? parseJobProgress(progress) : undefined;
  const updated = await prisma.job.updateMany({
    where: {
      id: jobId,
      status: JobStatus.RUNNING,
      lockedBy: lockOwner,
    },
    data: {
      heartbeatAt: now,
      ...(parsedProgress ? { progress: inputJson(parsedProgress) } : {}),
    },
  });
  if (updated.count === 1) return "ok";

  const current = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true, lockedBy: true },
  });
  if (
    current?.status === JobStatus.CANCELLED &&
    current.lockedBy === lockOwner
  ) {
    return "cancelled";
  }
  return "lost";
}

export type JobLeaseMutationResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "cancelled" | "lost" };

export async function withJobLease<T>(
  jobId: string,
  workerId: string,
  mutation: (tx: Prisma.TransactionClient) => Promise<T>,
  now: Date = new Date(),
): Promise<JobLeaseMutationResult<T>> {
  const lockOwner = validWorkerId(workerId);
  return prisma.$transaction(async (tx) => {
    const leases = await tx.$queryRaw<
      Array<{ status: JobStatus; lockedBy: string | null }>
    >(Prisma.sql`
      SELECT "status", "lockedBy"
      FROM "Job"
      WHERE "id" = ${jobId}
      FOR UPDATE
    `);
    const lease = leases[0];
    if (
      lease?.status === JobStatus.CANCELLED &&
      lease.lockedBy === lockOwner
    ) {
      return { kind: "cancelled" };
    }
    if (
      lease?.status !== JobStatus.RUNNING ||
      lease.lockedBy !== lockOwner
    ) {
      return { kind: "lost" };
    }

    await tx.job.update({
      where: { id: jobId },
      data: { heartbeatAt: now },
    });
    return {
      kind: "ok",
      value: await mutation(tx),
    };
  });
}

export async function completeJob(
  jobId: string,
  workerId: string,
  result: GmailSyncJobResult,
  now: Date = new Date(),
): Promise<boolean> {
  const lockOwner = validWorkerId(workerId);
  const parsed = parseJobResult(JobType.GMAIL_SYNC, result);
  const completed = await prisma.job.updateMany({
    where: {
      id: jobId,
      type: JobType.GMAIL_SYNC,
      status: JobStatus.RUNNING,
      lockedBy: lockOwner,
    },
    data: {
      status: JobStatus.COMPLETED,
      result: inputJson(parsed),
      progress: inputJson({
        phase: "COMPLETED",
        processed: parsed.conversationsProcessed,
        total: parsed.conversationsProcessed,
        percent: 100,
        message: "Gmail sync completed.",
      } satisfies GmailSyncJobProgress),
      completedAt: now,
      failedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lockedAt: null,
      lockedBy: null,
      heartbeatAt: now,
      idempotencyKey: null,
    },
  });
  if (completed.count === 1) {
    const durationMs = Math.max(
      0,
      Date.parse(parsed.completedAt) - Date.parse(parsed.startedAt),
    );
    logJobEvent("job_completed", {
      jobId,
      jobType: JobType.GMAIL_SYNC,
      workerId: lockOwner,
      durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
      messagesCreated: parsed.messagesCreated,
      conversationsProcessed: parsed.conversationsProcessed,
    });
  }
  return completed.count === 1;
}

export async function failJob(
  jobId: string,
  workerId: string,
  error: JobExecutionError,
  now: Date = new Date(),
): Promise<boolean> {
  const lockOwner = validWorkerId(workerId);
  const safeError = normalizeJobError(error);
  const failed = await prisma.job.updateMany({
    where: {
      id: jobId,
      status: JobStatus.RUNNING,
      lockedBy: lockOwner,
    },
    data: {
      status: JobStatus.FAILED,
      failedAt: now,
      lastErrorCode: safeError.code,
      lastErrorMessage: safeError.safeMessage,
      lockedAt: null,
      lockedBy: null,
      heartbeatAt: now,
      idempotencyKey: null,
    },
  });
  if (failed.count === 1) {
    logJobEvent("job_failed", {
      jobId,
      workerId: lockOwner,
    });
  }
  return failed.count === 1;
}

export async function retryJob(
  jobId: string,
  workerId: string,
  error: JobExecutionError,
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<RetryJobResult> {
  const lockOwner = validWorkerId(workerId);
  const safeError = normalizeJobError(error);
  if (!safeError.retryable) {
    const failed = await failJob(jobId, lockOwner, safeError, now);
    return { kind: failed ? "failed" : "lost" };
  }

  const current = await prisma.job.findFirst({
    where: {
      id: jobId,
      status: JobStatus.RUNNING,
      lockedBy: lockOwner,
    },
    select: {
      attemptCount: true,
      maxAttempts: true,
    },
  });
  if (!current) return { kind: "lost" };
  if (current.attemptCount >= current.maxAttempts) {
    const failed = await failJob(jobId, lockOwner, safeError, now);
    return { kind: failed ? "failed" : "lost" };
  }

  const availableAt = new Date(
    now.getTime() + retryDelayMs(current.attemptCount, random),
  );
  const retried = await prisma.job.updateMany({
    where: {
      id: jobId,
      status: JobStatus.RUNNING,
      lockedBy: lockOwner,
      attemptCount: current.attemptCount,
    },
    data: {
      status: JobStatus.RETRY_SCHEDULED,
      availableAt,
      progress: inputJson({
        phase: "QUEUED",
        processed: 0,
        message: "Retry scheduled.",
      } satisfies GmailSyncJobProgress),
      lastErrorCode: safeError.code,
      lastErrorMessage: safeError.safeMessage,
      lockedAt: null,
      lockedBy: null,
      heartbeatAt: now,
    },
  });
  if (retried.count !== 1) return { kind: "lost" };
  logJobEvent("job_retry_scheduled", {
    jobId,
    workerId: lockOwner,
    attempt: current.attemptCount,
  });
  return { kind: "retry-scheduled", availableAt };
}

export async function cancelPendingJob(
  ownerId: string,
  jobId: string,
  now: Date = new Date(),
): Promise<CancelJobResult> {
  const cancelled = await prisma.job.updateMany({
    where: {
      id: jobId,
      ownerId,
      status: {
        in: [JobStatus.PENDING, JobStatus.RETRY_SCHEDULED],
      },
    },
    data: {
      status: JobStatus.CANCELLED,
      completedAt: now,
      lastErrorCode: "JOB_CANCELLED",
      lastErrorMessage: "The job was cancelled.",
      lockedAt: null,
      lockedBy: null,
      heartbeatAt: now,
      idempotencyKey: null,
    },
  });
  return { kind: cancelled.count === 1 ? "cancelled" : "not-found" };
}

type GmailCancellationSummary = {
  cancelled: number;
  cancellationRequested: number;
};

async function cancelActiveGmailSyncJobsInTransaction(
  tx: Prisma.TransactionClient,
  ownerId: string,
  accountId: string,
  now: Date,
): Promise<GmailCancellationSummary> {
  const [summary] = await tx.$queryRaw<
    Array<GmailCancellationSummary>
  >(Prisma.sql`
    WITH "active" AS (
      SELECT "id", "status"
      FROM "Job"
      WHERE "ownerId" = ${ownerId}
        AND "type" = 'GMAIL_SYNC'::"JobType"
        AND "status" IN (
          'PENDING'::"JobStatus",
          'RUNNING'::"JobStatus",
          'RETRY_SCHEDULED'::"JobStatus"
        )
        AND "payload"->>'communicationAccountId' = ${accountId}
      FOR UPDATE
    ),
    "cancelled" AS (
      UPDATE "Job" AS job
      SET
        "status" = 'CANCELLED'::"JobStatus",
        "completedAt" = ${now},
        "lastErrorCode" = 'JOB_CANCELLED',
        "lastErrorMessage" = CASE
          WHEN "active"."status" = 'RUNNING'::"JobStatus"
            THEN 'Cancellation requested.'
          ELSE 'The job was cancelled.'
        END,
        "idempotencyKey" = NULL,
        "updatedAt" = ${now}
      FROM "active"
      WHERE job."id" = "active"."id"
      RETURNING "active"."status"
    )
    SELECT
      COUNT(*) FILTER (
        WHERE "status" IN (
          'PENDING'::"JobStatus",
          'RETRY_SCHEDULED'::"JobStatus"
        )
      )::int AS "cancelled",
      COUNT(*) FILTER (
        WHERE "status" = 'RUNNING'::"JobStatus"
      )::int AS "cancellationRequested"
    FROM "cancelled"
  `);
  return summary ?? { cancelled: 0, cancellationRequested: 0 };
}

function logGmailCancellation(
  ownerId: string,
  result: GmailCancellationSummary,
) {
  if (result.cancelled || result.cancellationRequested) {
    logJobEvent("job_cancelled", {
      ownerId,
      jobType: JobType.GMAIL_SYNC,
      count: result.cancelled + result.cancellationRequested,
    });
  }
}

export async function cancelActiveGmailSyncJobs(
  ownerId: string,
  accountId: string,
  now: Date = new Date(),
): Promise<GmailCancellationSummary> {
  const result = await prisma.$transaction(async (tx) => {
    await acquireGmailMailboxMutex(tx, ownerId, accountId);
    return cancelActiveGmailSyncJobsInTransaction(
      tx,
      ownerId,
      accountId,
      now,
    );
  });
  logGmailCancellation(ownerId, result);
  return result;
}

export async function disconnectGmailAccount(
  ownerId: string,
  accountId: string,
  now: Date = new Date(),
): Promise<DisconnectGmailAccountResult> {
  const result = await prisma.$transaction(async (tx) => {
    await acquireGmailMailboxMutex(tx, ownerId, accountId);
    const account = await tx.communicationAccount.findFirst({
      where: {
        id: accountId,
        ownerId,
        provider: "GMAIL",
      },
      select: {
        gmailCredential: {
          select: { encryptedRefreshToken: true },
        },
      },
    });
    if (!account) return { kind: "not-found" } as const;

    // Lock/cancel Job rows before mutating the account. Gmail job finalization
    // uses the same Job -> CommunicationAccount order, preventing deadlocks.
    const cancellation = await cancelActiveGmailSyncJobsInTransaction(
      tx,
      ownerId,
      accountId,
      now,
    );
    await tx.communicationAccount.updateMany({
      where: {
        id: accountId,
        ownerId,
        provider: "GMAIL",
      },
      data: {
        status: "DISCONNECTED",
        disconnectedAt: now,
        tokenExpiresAt: null,
      },
    });
    await tx.gmailCredential.deleteMany({
      where: { communicationAccountId: accountId },
    });
    return {
      kind: "disconnected",
      encryptedRefreshToken:
        account.gmailCredential?.encryptedRefreshToken ?? null,
      ...cancellation,
    } as const;
  });
  if (result.kind === "disconnected") {
    logGmailCancellation(ownerId, result);
  }
  return result;
}

export async function completeCancelledJob(
  jobId: string,
  workerId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const lockOwner = validWorkerId(workerId);
  const completed = await prisma.job.updateMany({
    where: {
      id: jobId,
      status: JobStatus.CANCELLED,
      lockedBy: lockOwner,
    },
    data: {
      completedAt: now,
      lockedAt: null,
      lockedBy: null,
      heartbeatAt: now,
      idempotencyKey: null,
    },
  });
  return completed.count === 1;
}

type StaleRecoveryOptions = {
  now?: Date;
  staleAfterMs?: number;
  limit?: number;
  random?: () => number;
};

type StaleRecovery = {
  status: "retried" | "failed";
  jobId: string;
  type: JobType;
  ownerId: string;
  attemptCount: number;
};

export async function recoverStaleJobs(
  options: StaleRecoveryOptions = {},
): Promise<{ recovered: number; retried: number; failed: number }> {
  const now = options.now ?? new Date();
  const configuredStaleMs = getJobConfig().staleAfterSeconds * SECOND_MS;
  const staleAfterMs = Math.max(
    60 * SECOND_MS,
    options.staleAfterMs ?? configuredStaleMs,
  );
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const limit = boundedLimit(options.limit, 10);
  const random = options.random ?? Math.random;
  const summary = { recovered: 0, retried: 0, failed: 0 };

  for (let index = 0; index < limit; index++) {
    const recovered = await prisma.$transaction(async (tx) => {
      const stale = await tx.$queryRaw<Job[]>(Prisma.sql`
        SELECT *
        FROM "Job"
        WHERE "status" = 'RUNNING'::"JobStatus"
          AND "completedAt" IS NULL
          AND COALESCE(
            "heartbeatAt",
            "lockedAt",
            "startedAt",
            "updatedAt"
          ) < ${staleBefore}
        ORDER BY
          COALESCE("heartbeatAt", "lockedAt", "startedAt", "updatedAt") ASC,
          "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const job = stale[0];
      if (!job) return null;

      const canRetry = job.attemptCount < job.maxAttempts;
      await tx.job.update({
        where: { id: job.id },
        data: canRetry
          ? {
              status: JobStatus.RETRY_SCHEDULED,
              availableAt: new Date(
                now.getTime() + retryDelayMs(job.attemptCount, random),
              ),
              progress: inputJson({
                phase: "QUEUED",
                processed: 0,
                message: "Retry scheduled after an interrupted run.",
              } satisfies GmailSyncJobProgress),
              lastErrorCode: "STALE_JOB_RECOVERED",
              lastErrorMessage:
                "The previous worker stopped responding. The job will retry.",
              lockedAt: null,
              lockedBy: null,
              heartbeatAt: now,
            }
          : {
              status: JobStatus.FAILED,
              failedAt: now,
              lastErrorCode: "STALE_JOB_ATTEMPTS_EXHAUSTED",
              lastErrorMessage:
                "The job stopped responding and exhausted its retry attempts.",
              lockedAt: null,
              lockedBy: null,
              heartbeatAt: now,
              idempotencyKey: null,
            },
      });
      return {
        status: canRetry ? "retried" : "failed",
        jobId: job.id,
        type: job.type,
        ownerId: job.ownerId,
        attemptCount: job.attemptCount,
      } satisfies StaleRecovery;
    });
    if (!recovered) break;
    summary.recovered++;
    summary[recovered.status]++;
    logJobEvent("stale_job_recovered", {
      jobId: recovered.jobId,
      jobType: recovered.type,
      ownerId: recovered.ownerId,
      attempt: recovered.attemptCount,
    });
  }
  return summary;
}

type PurgeOptions = {
  now?: Date;
  limit?: number;
  completedRetentionMs?: number;
  failedRetentionMs?: number;
};

export async function purgeExpiredJobs(
  options: PurgeOptions = {},
): Promise<{ deleted: number }> {
  const now = options.now ?? new Date();
  const completedRetentionMs = Math.max(
    DAY_MS,
    options.completedRetentionMs ?? COMPLETED_RETENTION_MS,
  );
  const failedRetentionMs = Math.max(
    DAY_MS,
    options.failedRetentionMs ?? FAILED_RETENTION_MS,
  );
  const completedBefore = new Date(
    now.getTime() - completedRetentionMs,
  );
  const failedBefore = new Date(
    now.getTime() - failedRetentionMs,
  );
  const limit = boundedLimit(options.limit, 100);
  const deleted = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH "expired" AS (
      SELECT "id"
      FROM "Job"
      WHERE (
        "status" IN (
          'COMPLETED'::"JobStatus",
          'CANCELLED'::"JobStatus"
        )
        AND COALESCE("completedAt", "updatedAt") < ${completedBefore}
      ) OR (
        "status" = 'FAILED'::"JobStatus"
        AND COALESCE("failedAt", "updatedAt") < ${failedBefore}
      )
      ORDER BY "updatedAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    DELETE FROM "Job" AS job
    USING "expired"
    WHERE job."id" = "expired"."id"
    RETURNING job."id"
  `);
  if (deleted.length) {
    logJobEvent("jobs_purged", { count: deleted.length });
  }
  return { deleted: deleted.length };
}
