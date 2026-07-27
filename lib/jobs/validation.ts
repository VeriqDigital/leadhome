import "server-only";

import { JobType } from "@prisma/client";
import { z } from "zod";
import type {
  ConversationAnalysisJobPayload,
  ConversationAnalysisJobProgress,
  ConversationAnalysisJobResult,
  GmailSyncJobPayload,
  GmailSyncJobProgress,
  GmailSyncJobResult,
  JobPayloadByType,
  JobProgress,
  JobResultByType,
} from "./types";

export const MAX_JOB_JSON_BYTES = 32 * 1024;
export const MAX_JOB_RESULT_ERRORS = 20;

export const gmailSyncJobPayloadSchema = z
  .object({
    communicationAccountId: z.cuid(),
    requestedBy: z.literal("USER"),
    threadLimit: z.number().int().min(1).max(100),
    trigger: z.literal("MANUAL"),
  })
  .strict();

export const gmailSyncJobProgressSchema = z
  .object({
    phase: z.enum([
      "QUEUED",
      "CONNECTING",
      "LISTING_THREADS",
      "IMPORTING_THREADS",
      "MATCHING",
      "FINALIZING",
      "COMPLETED",
    ]),
    processed: z.number().int().nonnegative().max(1_000_000),
    total: z.number().int().nonnegative().max(1_000_000).optional(),
    percent: z.number().min(0).max(100).optional(),
    message: z.string().trim().min(1).max(160),
  })
  .strict();

const safeResultErrorSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    message: z.string().trim().min(1).max(240),
  })
  .strict();

const boundedCount = z.number().int().nonnegative().max(10_000_000);

export const gmailSyncJobResultSchema = z
  .object({
    accountsProcessed: boundedCount,
    conversationsProcessed: boundedCount,
    conversationsCreated: boundedCount,
    conversationsUpdated: boundedCount,
    messagesCreated: boundedCount,
    messagesSkipped: boundedCount,
    conversationsMatched: boundedCount,
    conversationsNeedingReview: boundedCount,
    errors: z.array(safeResultErrorSchema).max(MAX_JOB_RESULT_ERRORS),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const conversationAnalysisJobPayloadSchema = z.object({
  conversationId: z.cuid(),
  trigger: z.enum([
    "GMAIL_IMPORT",
    "LEAD_LINKED",
    "MANUAL_REANALYSIS",
  ]),
  force: z.boolean(),
  analysisVersion: z.string().trim().min(1).max(64),
}).strict();

export const conversationAnalysisJobProgressSchema = z.object({
  phase: z.enum([
    "QUEUED",
    "PREPARING",
    "ANALYZING",
    "SAVING",
    "COMPLETED",
  ]),
  processed: z.number().int().nonnegative().max(10),
  total: z.number().int().nonnegative().max(10).optional(),
  percent: z.number().min(0).max(100).optional(),
  message: z.string().trim().min(1).max(160),
}).strict();

const nullableUsage = z.number().int().nonnegative().max(100_000_000).nullable();

export const conversationAnalysisJobResultSchema = z.object({
  conversationAnalysisId: z.cuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  analysisVersion: z.string().trim().min(1).max(64),
  outcome: z.enum([
    "COMPLETED",
    "SKIPPED_UNCHANGED",
    "SKIPPED_NO_CONTENT",
  ]),
  model: z.string().trim().min(1).max(200).nullable(),
  inputTokens: nullableUsage,
  outputTokens: nullableUsage,
  totalTokens: nullableUsage,
  durationMs: z.number().int().nonnegative().max(86_400_000).nullable(),
  inputTruncated: z.boolean(),
}).strict();

function assertBoundedJson(value: unknown, label: string): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_JOB_JSON_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_JOB_JSON_BYTES}-byte limit.`);
  }
}

export function parseJobPayload<T extends JobType>(
  type: T,
  value: unknown,
): JobPayloadByType[T] {
  let parsed: GmailSyncJobPayload | ConversationAnalysisJobPayload;
  switch (type) {
    case JobType.GMAIL_SYNC:
      parsed = gmailSyncJobPayloadSchema.parse(value);
      break;
    case JobType.CONVERSATION_ANALYSIS:
      parsed = conversationAnalysisJobPayloadSchema.parse(value);
      break;
    default:
      throw new Error(`Unsupported job type: ${String(type)}`);
  }
  assertBoundedJson(parsed, "Job payload");
  return parsed as JobPayloadByType[T];
}

export function parseJobProgress(value: unknown): JobProgress {
  const gmail = gmailSyncJobProgressSchema.safeParse(value);
  const parsed: GmailSyncJobProgress | ConversationAnalysisJobProgress =
    gmail.success
      ? gmail.data
      : conversationAnalysisJobProgressSchema.parse(value);
  assertBoundedJson(parsed, "Job progress");
  return parsed;
}

export function parseJobResult<T extends JobType>(
  type: T,
  value: unknown,
): JobResultByType[T] {
  let parsed: GmailSyncJobResult | ConversationAnalysisJobResult;
  switch (type) {
    case JobType.GMAIL_SYNC:
      parsed = gmailSyncJobResultSchema.parse(value);
      break;
    case JobType.CONVERSATION_ANALYSIS:
      parsed = conversationAnalysisJobResultSchema.parse(value);
      break;
    default:
      throw new Error(`Unsupported job type: ${String(type)}`);
  }
  assertBoundedJson(parsed, "Job result");
  return parsed as JobResultByType[T];
}
