import "server-only";

const ERROR_CODE_LIMIT = 64;
const ERROR_MESSAGE_LIMIT = 240;

function safeCode(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]/g, "_");
  return normalized.slice(0, ERROR_CODE_LIMIT) || "JOB_ERROR";
}

function safeMessage(value: string): string {
  return value.trim().slice(0, ERROR_MESSAGE_LIMIT) || "The job could not be completed.";
}

export class JobExecutionError extends Error {
  readonly code: string;
  readonly safeMessage: string;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    retryable: boolean,
    options?: ErrorOptions,
  ) {
    const boundedMessage = safeMessage(message);
    super(boundedMessage, options);
    this.name = "JobExecutionError";
    this.code = safeCode(code);
    this.safeMessage = boundedMessage;
    this.retryable = retryable;
  }
}

export class JobCancelledError extends JobExecutionError {
  constructor() {
    super("JOB_CANCELLED", "The job was cancelled.", false);
    this.name = "JobCancelledError";
  }
}

export class JobLeaseLostError extends Error {
  constructor() {
    super("The job lease is no longer owned by this worker.");
    this.name = "JobLeaseLostError";
  }
}

export class ConversationAnalysisAttemptError extends JobExecutionError {
  readonly conversationId: string;
  readonly attemptedContentHash: string;

  constructor(
    error: JobExecutionError,
    conversationId: string,
    attemptedContentHash: string,
  ) {
    super(error.code, error.safeMessage, error.retryable, { cause: error });
    this.name = "ConversationAnalysisAttemptError";
    this.conversationId = conversationId;
    this.attemptedContentHash = attemptedContentHash;
  }
}

export function normalizeJobError(error: unknown): JobExecutionError {
  if (error instanceof JobExecutionError) return error;
  return new JobExecutionError(
    "UNEXPECTED_JOB_ERROR",
    "The job encountered a temporary error and will be retried.",
    true,
    error instanceof Error ? { cause: error } : undefined,
  );
}
