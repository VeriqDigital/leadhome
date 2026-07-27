import "server-only";

import type { JobType } from "@prisma/client";

export type JobLogEvent =
  | "job_queued"
  | "job_claimed"
  | "job_started"
  | "job_retry_scheduled"
  | "job_completed"
  | "job_failed"
  | "job_cancelled"
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
};

export function logJobEvent(
  event: JobLogEvent,
  details: JobLogDetails = {},
): void {
  // The fixed detail shape intentionally excludes payloads, provider responses,
  // credentials, message bodies, stack traces, and arbitrary error messages.
  console.info("[LeadHome] job", { event, ...details });
}
