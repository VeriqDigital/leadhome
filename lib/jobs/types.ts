import type { Job, JobStatus, JobType } from "@prisma/client";

export const ACTIVE_JOB_STATUSES = [
  "PENDING",
  "RUNNING",
  "RETRY_SCHEDULED",
] as const satisfies readonly JobStatus[];

export const TERMINAL_JOB_STATUSES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const satisfies readonly JobStatus[];

export type GmailSyncJobPayload = {
  communicationAccountId: string;
  requestedBy: "USER";
  threadLimit: number;
  trigger: "MANUAL";
};

export type GmailSyncProgressPhase =
  | "QUEUED"
  | "CONNECTING"
  | "LISTING_THREADS"
  | "IMPORTING_THREADS"
  | "MATCHING"
  | "FINALIZING"
  | "COMPLETED";

export type GmailSyncJobProgress = {
  phase: GmailSyncProgressPhase;
  processed: number;
  total?: number;
  percent?: number;
  message: string;
};

export type SafeJobResultError = {
  code: string;
  message: string;
};

export type GmailSyncJobResult = {
  accountsProcessed: number;
  conversationsProcessed: number;
  conversationsCreated: number;
  conversationsUpdated: number;
  messagesCreated: number;
  messagesSkipped: number;
  conversationsMatched: number;
  conversationsNeedingReview: number;
  errors: SafeJobResultError[];
  startedAt: string;
  completedAt: string;
};

export type JobPayloadByType = {
  GMAIL_SYNC: GmailSyncJobPayload;
};

export type JobResultByType = {
  GMAIL_SYNC: GmailSyncJobResult;
};

export type GmailSyncJobView = {
  id: string;
  communicationAccountId: string;
  type: "GMAIL_SYNC";
  status: JobStatus;
  progress: GmailSyncJobProgress | null;
  result: GmailSyncJobResult | null;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  active: boolean;
};

export type EnqueueGmailSyncResult =
  | {
      kind: "queued" | "existing";
      job: GmailSyncJobView;
    }
  | {
      kind: "not-found";
    };

export type HeartbeatResult = "ok" | "cancelled" | "lost";

export type RetryJobResult =
  | {
      kind: "retry-scheduled";
      availableAt: Date;
    }
  | {
      kind: "failed" | "lost";
    };

export type ClaimedJob = Job;

export function isActiveJobStatus(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(
    status as (typeof ACTIVE_JOB_STATUSES)[number],
  );
}

export function assertNeverJobType(type: never): never {
  throw new Error(`Unsupported job type: ${String(type)}`);
}

export type SupportedJobType = Extract<JobType, keyof JobPayloadByType>;
