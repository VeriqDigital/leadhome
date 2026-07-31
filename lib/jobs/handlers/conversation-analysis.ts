import "server-only";

import { JobStatus, JobType, Prisma, type Job } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getConversationAnalysisConfig } from "@/lib/ai/config";
import {
  loadConversationAnalysisSource,
  prepareConversationInput,
} from "@/lib/ai/conversation-analysis/prepare-input";
import {
  OpenAIConversationAnalysisProvider,
  type ConversationAnalysisProvider,
} from "@/lib/ai/conversation-analysis/provider";
import { parseConversationAnalysisOutput } from "@/lib/ai/conversation-analysis/schema";
import { prisma } from "@/lib/prisma";
import {
  ConversationAnalysisAttemptError,
  JobCancelledError,
  JobExecutionError,
  JobLeaseLostError,
  normalizeJobError,
} from "@/lib/jobs/errors";
import { logJobEvent } from "@/lib/jobs/logging";
import { heartbeatJob, withJobLease } from "@/lib/jobs/service";
import type {
  ConversationAnalysisJobProgress,
  ConversationAnalysisJobResult,
} from "@/lib/jobs/types";
import {
  conversationAnalysisJobPayloadSchema,
  conversationAnalysisJobResultSchema,
} from "@/lib/jobs/validation";
import { recordActivity } from "@/lib/activity-service";
import {
  detectCompanyAfterAttachment,
} from "@/lib/messaging/company-detection-service";

function assertLeaseMutation(result: { kind: "ok" | "cancelled" | "lost" }) {
  if (result.kind === "cancelled") throw new JobCancelledError();
  if (result.kind !== "ok") throw new JobLeaseLostError();
}

async function checkpoint(
  jobId: string,
  workerId: string,
  progress: ConversationAnalysisJobProgress,
) {
  const lease = await heartbeatJob(jobId, workerId, progress);
  if (lease === "cancelled") throw new JobCancelledError();
  if (lease !== "ok") throw new JobLeaseLostError();
}

function requestTimeoutMs(deadlineAt: number | undefined) {
  const configured = getConversationAnalysisConfig().requestTimeoutMs;
  if (deadlineAt === undefined) return configured;
  const remaining = deadlineAt - Date.now() - 1_000;
  if (remaining < 1_000) {
    throw new JobExecutionError(
      "JOB_TIME_BUDGET_EXCEEDED",
      "Conversation analysis reached the worker execution limit.",
      true,
    );
  }
  return Math.min(configured, remaining);
}

async function markCancelledForEligibility({
  job,
  workerId,
  message,
}: {
  job: Job;
  workerId: string;
  message: string;
}): Promise<never> {
  const mutation = await withJobLease(job.id, workerId, async (tx) => {
    await tx.conversationAnalysis.updateMany({
      where: {
        ownerId: job.ownerId,
        latestJobId: job.id,
      },
      data: {
        status: "CANCELLED",
        lastErrorCode: "AI_INELIGIBLE",
        lastErrorMessage: message,
      },
    });
    await tx.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.CANCELLED,
        completedAt: new Date(),
        lastErrorCode: "AI_INELIGIBLE",
        lastErrorMessage: message,
        idempotencyKey: null,
      },
    });
  });
  assertLeaseMutation(mutation);
  logJobEvent("analysis_cancelled", {
    jobId: job.id,
    jobType: JobType.CONVERSATION_ANALYSIS,
    ownerId: job.ownerId,
    attempt: job.attemptCount,
  });
  throw new JobCancelledError();
}

async function persistFailure(
  job: Job,
  workerId: string,
  error: JobExecutionError,
) {
  const mutation = await withJobLease(job.id, workerId, async (tx) => {
    await tx.conversationAnalysis.updateMany({
      where: {
        ownerId: job.ownerId,
        latestJobId: job.id,
      },
      data: {
        status: "FAILED",
        lastErrorCode: error.code,
        lastErrorMessage: error.safeMessage,
      },
    });
  });
  assertLeaseMutation(mutation);
  logJobEvent("analysis_failed", {
    jobId: job.id,
    jobType: JobType.CONVERSATION_ANALYSIS,
    ownerId: job.ownerId,
    attempt: job.attemptCount,
  });
}

export async function runConversationAnalysisJob(
  job: Job,
  {
    workerId,
    deadlineAt,
    provider = new OpenAIConversationAnalysisProvider(),
  }: {
    workerId: string;
    deadlineAt?: number;
    provider?: ConversationAnalysisProvider;
  },
): Promise<ConversationAnalysisJobResult> {
  const payload = conversationAnalysisJobPayloadSchema.safeParse(job.payload);
  if (!payload.success) {
    throw new JobExecutionError(
      "INVALID_JOB_PAYLOAD",
      "The conversation analysis request was invalid.",
      false,
    );
  }
  const started = Date.now();
  let attemptedContentHash: string | null = null;
  try {
    await checkpoint(job.id, workerId, {
      phase: "PREPARING",
      processed: 0,
      total: 3,
      percent: 5,
      message: "Preparing conversation text.",
    });
    const [user, source, analysis] = await Promise.all([
      prisma.user.findUnique({
        where: { id: job.ownerId },
        select: { conversationIntelligenceEnabled: true },
      }),
      loadConversationAnalysisSource(
        job.ownerId,
        payload.data.conversationId,
      ),
      prisma.conversationAnalysis.findUnique({
        where: {
          conversationId_ownerId: {
            conversationId: payload.data.conversationId,
            ownerId: job.ownerId,
          },
        },
      }),
    ]);
    if (!user?.conversationIntelligenceEnabled) {
      return await markCancelledForEligibility({
        job,
        workerId,
        message: "Conversation Intelligence is disabled.",
      });
    }
    if (!source) {
      throw new JobExecutionError(
        "CONVERSATION_NOT_FOUND",
        "The conversation is no longer available.",
        false,
      );
    }
    if (payload.data.trigger !== "MANUAL_REANALYSIS" && !source.leadId) {
      return await markCancelledForEligibility({
        job,
        workerId,
        message: "The conversation is no longer attached to a lead.",
      });
    }
    if (!analysis || analysis.latestJobId !== job.id) {
      throw new JobLeaseLostError();
    }

    const config = getConversationAnalysisConfig();
    const prepared = prepareConversationInput({
      source,
      analysisVersion: payload.data.analysisVersion,
      maxInputChars: config.maxInputChars,
    });
    attemptedContentHash = prepared.contentHash;
    // A worker can persist the canonical result and then lose its lease or
    // encounter a transient failure while completing the Job row. On retry,
    // recognize the success fenced to this same job and do not pay for or
    // perform inference a second time. A newly queued force job starts in
    // QUEUED, so it does not take this recovery path.
    if (
      analysis.status === "COMPLETED" &&
      analysis.latestJobId === job.id &&
      analysis.contentHash === prepared.contentHash &&
      analysis.analysisVersion === payload.data.analysisVersion
    ) {
      return conversationAnalysisJobResultSchema.parse({
        conversationAnalysisId: analysis.id,
        contentHash: prepared.contentHash,
        analysisVersion: payload.data.analysisVersion,
        outcome: "COMPLETED",
        model: analysis.model,
        inputTokens: analysis.inputTokens,
        outputTokens: analysis.outputTokens,
        totalTokens: analysis.totalTokens,
        durationMs: analysis.durationMs,
        inputTruncated: analysis.inputTruncated,
      });
    }
    if (!prepared.hasMeaningfulContent) {
      const preserveCompletedOutput = Boolean(
        analysis.completedAt && analysis.structuredData,
      );
      const mutation = await withJobLease(job.id, workerId, async (tx) => {
        const updated = await tx.conversationAnalysis.updateMany({
          where: {
            ownerId: job.ownerId,
            conversationId: payload.data.conversationId,
            latestJobId: job.id,
          },
          data: {
            status: "SKIPPED",
            ...(preserveCompletedOutput
              ? {}
              : {
                  contentHash: prepared.contentHash,
                  analysisVersion: payload.data.analysisVersion,
                  sourceMessageCount: prepared.sourceMessageCount,
                  inputTruncated: prepared.inputTruncated,
                }),
            lastErrorCode: "AI_NO_CONTENT",
            lastErrorMessage:
              "This conversation does not contain analyzable message text.",
          },
        });
        if (updated.count !== 1) throw new JobLeaseLostError();
      });
      assertLeaseMutation(mutation);
      return conversationAnalysisJobResultSchema.parse({
        conversationAnalysisId: analysis.id,
        contentHash: prepared.contentHash,
        analysisVersion: payload.data.analysisVersion,
        outcome: "SKIPPED_NO_CONTENT",
        model: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        durationMs: Date.now() - started,
        inputTruncated: prepared.inputTruncated,
      });
    }
    if (
      !payload.data.force &&
      analysis.completedAt &&
      analysis.contentHash === prepared.contentHash &&
      analysis.analysisVersion === payload.data.analysisVersion
    ) {
      const mutation = await withJobLease(job.id, workerId, async (tx) => {
        const updated = await tx.conversationAnalysis.updateMany({
          where: {
            ownerId: job.ownerId,
            conversationId: payload.data.conversationId,
            latestJobId: job.id,
          },
          data: {
            status: "COMPLETED",
            sourceMessageCount: prepared.sourceMessageCount,
            inputTruncated: prepared.inputTruncated,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
        if (updated.count !== 1) throw new JobLeaseLostError();
      });
      assertLeaseMutation(mutation);
      logJobEvent("analysis_unchanged_skipped", {
        jobId: job.id,
        jobType: JobType.CONVERSATION_ANALYSIS,
        conversationAnalysisId: analysis.id,
        ownerId: job.ownerId,
        trigger: payload.data.trigger,
      });
      return conversationAnalysisJobResultSchema.parse({
        conversationAnalysisId: analysis.id,
        contentHash: prepared.contentHash,
        analysisVersion: payload.data.analysisVersion,
        outcome: "SKIPPED_UNCHANGED",
        model: analysis.model,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        durationMs: Date.now() - started,
        inputTruncated: prepared.inputTruncated,
      });
    }

    const running = await withJobLease(job.id, workerId, async (tx) => {
      const updated = await tx.conversationAnalysis.updateMany({
        where: {
          ownerId: job.ownerId,
          conversationId: payload.data.conversationId,
          latestJobId: job.id,
        },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (updated.count !== 1) throw new JobLeaseLostError();
    });
    assertLeaseMutation(running);
    logJobEvent("analysis_started", {
      jobId: job.id,
      jobType: JobType.CONVERSATION_ANALYSIS,
      conversationAnalysisId: analysis.id,
      ownerId: job.ownerId,
      trigger: payload.data.trigger,
      attempt: job.attemptCount,
      inputTruncated: prepared.inputTruncated,
    });
    await checkpoint(job.id, workerId, {
      phase: "ANALYZING",
      processed: 1,
      total: 3,
      percent: 30,
      message: "Analyzing the conversation.",
    });
    const providerResult = await provider.analyze({
      text: prepared.text,
      includedMessageCount: prepared.includedMessageCount,
      timeoutMs: requestTimeoutMs(deadlineAt),
    });
    const structured = parseConversationAnalysisOutput(
      providerResult.analysis,
      prepared.includedMessageCount,
    );
    await checkpoint(job.id, workerId, {
      phase: "SAVING",
      processed: 2,
      total: 3,
      percent: 85,
      message: "Saving conversation intelligence.",
    });
    const durationMs = Date.now() - started;
    const completedAt = new Date();
    const completedResult = conversationAnalysisJobResultSchema.parse({
      conversationAnalysisId: analysis.id,
      contentHash: prepared.contentHash,
      analysisVersion: payload.data.analysisVersion,
      outcome: "COMPLETED",
      model: providerResult.model,
      inputTokens: providerResult.inputTokens,
      outputTokens: providerResult.outputTokens,
      totalTokens: providerResult.totalTokens,
      durationMs,
      inputTruncated: prepared.inputTruncated,
    });
    const persisted = await withJobLease(job.id, workerId, async (tx) => {
      const updated = await tx.conversationAnalysis.updateMany({
        where: {
          ownerId: job.ownerId,
          conversationId: payload.data.conversationId,
          latestJobId: job.id,
        },
        data: {
          status: "COMPLETED",
          contentHash: prepared.contentHash,
          analysisVersion: payload.data.analysisVersion,
          summary: structured.summary,
          structuredData: structured as Prisma.InputJsonValue,
          model: completedResult.model,
          inputTokens: completedResult.inputTokens,
          outputTokens: completedResult.outputTokens,
          totalTokens: completedResult.totalTokens,
          durationMs,
          sourceMessageCount: prepared.sourceMessageCount,
          inputTruncated: prepared.inputTruncated,
          completedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      if (updated.count !== 1) throw new JobLeaseLostError();
      const conversation = await tx.conversation.findFirst({
        where: {
          id: payload.data.conversationId,
          ownerId: job.ownerId,
        },
        select: { id: true, leadId: true },
      });
      if (!conversation) throw new JobLeaseLostError();
      await recordActivity(tx, {
        ownerId: job.ownerId,
        leadId: conversation.leadId,
        conversationId: conversation.id,
        type: "AI_ANALYSIS_COMPLETED",
        actorType: "AI",
        source: "AI",
        title: "Conversation analysis completed",
        description: "Summary and suggested next steps are ready.",
        metadata: {
          analysisId: analysis.id,
          actionItemCount: structured.actionItems.length,
          inputTruncated: prepared.inputTruncated,
        },
        occurredAt: completedAt,
        idempotencyKey: `analysis-completed:${analysis.id}:${job.id}`,
      });
    });
    assertLeaseMutation(persisted);
    const companyDetection = await detectCompanyAfterAttachment(
      job.ownerId,
      payload.data.conversationId,
    );
    logJobEvent("analysis_completed", {
      jobId: job.id,
      jobType: JobType.CONVERSATION_ANALYSIS,
      conversationAnalysisId: analysis.id,
      ownerId: job.ownerId,
      trigger: payload.data.trigger,
      model: completedResult.model ?? undefined,
      inputTokens: completedResult.inputTokens ?? undefined,
      outputTokens: completedResult.outputTokens ?? undefined,
      durationMs,
      inputTruncated: prepared.inputTruncated,
    });
    revalidatePath("/inbox");
    revalidatePath("/");
    const affectedLeadIds = new Set(
      [
        source.leadId,
        companyDetection?.companyView.lead?.id,
      ].filter((leadId): leadId is string => Boolean(leadId)),
    );
    if (affectedLeadIds.size) {
      revalidatePath("/leads");
      revalidatePath("/leads/[id]", "page");
      revalidatePath("/pipeline");
      for (const leadId of affectedLeadIds) {
        revalidatePath(`/leads/${leadId}`);
      }
    }
    return completedResult;
  } catch (error) {
    if (
      error instanceof JobCancelledError ||
      error instanceof JobLeaseLostError
    ) {
      throw error;
    }
    const failure =
      error instanceof ZodError
        ? new JobExecutionError(
            "AI_INVALID_STRUCTURED_OUTPUT",
            "The AI provider returned an invalid structured analysis.",
            false,
            { cause: error },
          )
        : normalizeJobError(error);
    await persistFailure(job, workerId, failure);
    throw attemptedContentHash
      ? new ConversationAnalysisAttemptError(
          failure,
          payload.data.conversationId,
          attemptedContentHash,
        )
      : failure;
  }
}
