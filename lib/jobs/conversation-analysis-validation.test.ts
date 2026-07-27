import { describe, expect, it } from "vitest";
import {
  conversationAnalysisJobPayloadSchema,
  conversationAnalysisJobProgressSchema,
  conversationAnalysisJobResultSchema,
} from "./validation";

const conversationId = "cm123456789012345678901234";
const analysisId = "cm987654321098765432109876";

const payload = {
  conversationId,
  trigger: "MANUAL_REANALYSIS" as const,
  force: true,
  analysisVersion: "conversation-v1",
};

const progress = {
  phase: "ANALYZING" as const,
  processed: 1,
  total: 3,
  percent: 30,
  message: "Analyzing the conversation.",
};

const result = {
  conversationAnalysisId: analysisId,
  contentHash: "a".repeat(64),
  analysisVersion: "conversation-v1",
  outcome: "COMPLETED" as const,
  model: "configured-model",
  inputTokens: 1_000,
  outputTokens: 200,
  totalTokens: 1_200,
  durationMs: 2_500,
  inputTruncated: false,
};

describe("conversation analysis job JSON contracts", () => {
  it("accepts the bounded identifier-only payload", () => {
    expect(conversationAnalysisJobPayloadSchema.parse(payload)).toEqual(
      payload,
    );
  });

  it("rejects sensitive or unbounded payload additions", () => {
    for (const field of [
      "messageBody",
      "subject",
      "participants",
      "apiKey",
      "oauthCredential",
      "prompt",
      "modelResponse",
    ]) {
      expect(conversationAnalysisJobPayloadSchema.safeParse({
        ...payload,
        [field]: "must-not-be-persisted",
      }).success).toBe(false);
    }
    expect(conversationAnalysisJobPayloadSchema.safeParse({
      ...payload,
      analysisVersion: "x".repeat(65),
    }).success).toBe(false);
    expect(conversationAnalysisJobPayloadSchema.safeParse({
      ...payload,
      conversationId: "foreign-or-malformed-id",
    }).success).toBe(false);
  });

  it("validates bounded static progress without accepting content fields", () => {
    expect(conversationAnalysisJobProgressSchema.parse(progress)).toEqual(
      progress,
    );
    expect(conversationAnalysisJobProgressSchema.safeParse({
      ...progress,
      percent: 101,
    }).success).toBe(false);
    expect(conversationAnalysisJobProgressSchema.safeParse({
      ...progress,
      processed: 11,
    }).success).toBe(false);
    expect(conversationAnalysisJobProgressSchema.safeParse({
      ...progress,
      emailBody: "private conversation text",
    }).success).toBe(false);
  });

  it("accepts only bounded operational result metadata", () => {
    expect(conversationAnalysisJobResultSchema.parse(result)).toEqual(result);
    expect(conversationAnalysisJobResultSchema.safeParse({
      ...result,
      contentHash: "not-a-sha256-hash",
    }).success).toBe(false);
    expect(conversationAnalysisJobResultSchema.safeParse({
      ...result,
      inputTokens: -1,
    }).success).toBe(false);
    expect(conversationAnalysisJobResultSchema.safeParse({
      ...result,
      model: "x".repeat(201),
    }).success).toBe(false);

    for (const field of [
      "summary",
      "structuredData",
      "rawResponse",
      "prompt",
      "messageBody",
    ]) {
      expect(conversationAnalysisJobResultSchema.safeParse({
        ...result,
        [field]: "must-not-be-persisted-in-job-result",
      }).success).toBe(false);
    }
  });

  it("supports bounded skipped outcomes without fabricated usage", () => {
    expect(conversationAnalysisJobResultSchema.parse({
      ...result,
      outcome: "SKIPPED_NO_CONTENT",
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      durationMs: null,
    })).toEqual(expect.objectContaining({
      outcome: "SKIPPED_NO_CONTENT",
      model: null,
      inputTokens: null,
    }));
  });
});
