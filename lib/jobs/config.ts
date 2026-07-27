import "server-only";

export const JOB_DEFAULT_MAX_ATTEMPTS = 3;
export const JOB_DEFAULT_STALE_AFTER_SECONDS = 15 * 60;
export const JOB_DEFAULT_JOBS_PER_RUN = 3;
export const JOB_DEFAULT_RUN_TIME_BUDGET_MS = 45_000;
export const JOB_DEFAULT_GMAIL_THREAD_LIMIT = 50;

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export type JobConfig = {
  runnerSecret: string | null;
  maxAttempts: number;
  staleAfterSeconds: number;
  jobsPerRun: number;
  runTimeBudgetMs: number;
  gmailThreadLimit: number;
};

export function getJobConfig(): JobConfig {
  const configuredSecret = process.env.JOB_RUNNER_SECRET;
  const normalizedSecret = configuredSecret?.trim();
  return {
    runnerSecret:
      configuredSecret === normalizedSecret &&
      normalizedSecret &&
      normalizedSecret.length >= 40
        ? normalizedSecret
        : null,
    maxAttempts: boundedInteger(
      process.env.JOB_MAX_ATTEMPTS,
      JOB_DEFAULT_MAX_ATTEMPTS,
      1,
      10,
    ),
    staleAfterSeconds: boundedInteger(
      process.env.JOB_STALE_AFTER_SECONDS,
      JOB_DEFAULT_STALE_AFTER_SECONDS,
      60,
      86_400,
    ),
    jobsPerRun: boundedInteger(
      process.env.JOBS_PER_RUN,
      JOB_DEFAULT_JOBS_PER_RUN,
      1,
      20,
    ),
    runTimeBudgetMs: boundedInteger(
      process.env.JOB_RUN_TIME_BUDGET_MS,
      JOB_DEFAULT_RUN_TIME_BUDGET_MS,
      1_000,
      55_000,
    ),
    gmailThreadLimit: boundedInteger(
      process.env.GMAIL_SYNC_THREAD_LIMIT,
      JOB_DEFAULT_GMAIL_THREAD_LIMIT,
      1,
      100,
    ),
  };
}
