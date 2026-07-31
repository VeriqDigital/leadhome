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

export type ConversationAnalysisTrigger =
  | "GMAIL_IMPORT"
  | "LEAD_LINKED"
  | "MANUAL_REANALYSIS";

export type ConversationAnalysisJobPayload = {
  conversationId: string;
  trigger: ConversationAnalysisTrigger;
  force: boolean;
  analysisVersion: string;
};

export type ConversationAnalysisProgressPhase =
  | "QUEUED"
  | "PREPARING"
  | "ANALYZING"
  | "SAVING"
  | "COMPLETED";

export type ConversationAnalysisJobProgress = {
  phase: ConversationAnalysisProgressPhase;
  processed: number;
  total?: number;
  percent?: number;
  message: string;
};

export type ConversationAnalysisJobResult = {
  conversationAnalysisId: string;
  contentHash: string;
  analysisVersion: string;
  outcome: "COMPLETED" | "SKIPPED_UNCHANGED" | "SKIPPED_NO_CONTENT";
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  inputTruncated: boolean;
};

export type CompanyDetectionJobPayload = {
  conversationId: string;
  trigger: "GMAIL_IMPORT";
};

export type CompanyDetectionJobProgress = {
  phase: "QUEUED" | "DETECTING" | "COMPLETED";
  processed: number;
  total?: number;
  percent?: number;
  message: string;
};

export type CompanyDetectionJobResult = {
  conversationId: string;
  changed: boolean;
  outcome: "APPLIED" | "NO_CHANGE" | "STALE" | "NOT_APPLICABLE";
  companyState:
    | "NOT_APPLICABLE"
    | "COMPANY_PRESENT"
    | "SUGGESTED"
    | "NO_SUGGESTION";
  leadId: string | null;
  durationMs: number;
};

export type JobPayloadByType = {
  GMAIL_SYNC: GmailSyncJobPayload;
  CONVERSATION_ANALYSIS: ConversationAnalysisJobPayload;
  COMPANY_DETECTION: CompanyDetectionJobPayload;
};

export type JobResultByType = {
  GMAIL_SYNC: GmailSyncJobResult;
  CONVERSATION_ANALYSIS: ConversationAnalysisJobResult;
  COMPANY_DETECTION: CompanyDetectionJobResult;
};

export type JobProgress =
  | GmailSyncJobProgress
  | ConversationAnalysisJobProgress
  | CompanyDetectionJobProgress;

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

export type ConversationAnalysisJobView = {
  id: string;
  type: "CONVERSATION_ANALYSIS";
  status: JobStatus;
  progress: ConversationAnalysisJobProgress | null;
  result: Pick<
    ConversationAnalysisJobResult,
    "outcome" | "inputTruncated"
  > | null;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: string;
  active: boolean;
};

export type EnqueueConversationAnalysisResult =
  | {
      kind: "queued" | "existing";
      job: ConversationAnalysisJobView;
    }
  | {
      kind:
        | "not-found"
        | "disabled"
        | "unlinked"
        | "unchanged"
        | "no-content";
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
