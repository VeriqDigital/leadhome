import "server-only";

import type { JobType } from "@prisma/client";
import type { ConversationAnalysisTrigger } from "./types";

export type JobLogEvent =
  | "job_queued"
  | "job_claimed"
  | "job_started"
  | "job_retry_scheduled"
  | "job_completed"
  | "job_failed"
  | "job_cancelled"
  | "analysis_queued"
  | "analysis_job_reused"
  | "analysis_unchanged_skipped"
  | "analysis_started"
  | "analysis_completed"
  | "analysis_failed"
  | "analysis_cancelled"
  | "analysis_enqueue_failed"
  | "company_detection_queued"
  | "company_detection_enqueue_failed"
  | "stale_job_recovered"
  | "jobs_purged";

export type JobLogDetails = {
  jobId?: string;
  jobType?: JobType;
  ownerId?: string;
  workerId?: string;
  attempt?: number;
  durationMs?: number;
  count?: number;
  messagesCreated?: number;
  conversationsProcessed?: number;
  conversationAnalysisId?: string;
  trigger?: ConversationAnalysisTrigger;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  inputTruncated?: boolean;
  errorCode?: string;
  queued?: number;
  reused?: number;
  skipped?: number;
  failed?: number;
};

export function logJobEvent(
  event: JobLogEvent,
  details: JobLogDetails = {},
): void {
  // The fixed detail shape intentionally excludes payloads, provider responses,
  // credentials, message bodies, stack traces, and arbitrary error messages.
  console.info("[LeadHome] job", { event, ...details });
}
