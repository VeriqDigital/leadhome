import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  conversationAnalysisConfigurationStatus,
  getConversationAnalysisConfig,
} from "./config";

const environmentKeys = [
  "OPENAI_API_KEY",
  "OPENAI_CONVERSATION_ANALYSIS_MODEL",
  "AI_ANALYSIS_MAX_INPUT_CHARS",
  "AI_ANALYSIS_REQUEST_TIMEOUT_MS",
  "AI_ANALYSIS_VERSION",
] as const;

const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]]),
);

function clearConfiguration() {
  for (const key of environmentKeys) delete process.env[key];
}

beforeEach(clearConfiguration);

afterEach(() => {
  for (const key of environmentKeys) {
    const original = originalEnvironment.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("conversation analysis configuration", () => {
  it("is unavailable without explicit server-side provider configuration", () => {
    expect(getConversationAnalysisConfig()).toEqual({
      apiKey: null,
      model: null,
      maxInputChars: 60_000,
      requestTimeoutMs: 45_000,
      analysisVersion: "conversation-v1",
    });
    expect(conversationAnalysisConfigurationStatus()).toEqual({
      available: false,
      message:
        "Conversation analysis is unavailable until the server configuration is completed.",
    });
  });

  it("requires both the API key and an explicitly configured model", () => {
    process.env.OPENAI_API_KEY = "test-key";
    expect(conversationAnalysisConfigurationStatus().available).toBe(false);

    process.env.OPENAI_CONVERSATION_ANALYSIS_MODEL = "configured-model";
    expect(conversationAnalysisConfigurationStatus()).toEqual({
      available: true,
      message: "OpenAI is configured for Conversation Intelligence.",
    });
  });

  it("uses bounded defaults for invalid limits and accepts valid overrides", () => {
    process.env.AI_ANALYSIS_MAX_INPUT_CHARS = "3999";
    process.env.AI_ANALYSIS_REQUEST_TIMEOUT_MS = "120001";
    process.env.AI_ANALYSIS_VERSION = " ";
    expect(getConversationAnalysisConfig()).toEqual(expect.objectContaining({
      maxInputChars: 60_000,
      requestTimeoutMs: 45_000,
      analysisVersion: "conversation-v1",
    }));

    process.env.AI_ANALYSIS_MAX_INPUT_CHARS = "80000";
    process.env.AI_ANALYSIS_REQUEST_TIMEOUT_MS = "30000";
    process.env.AI_ANALYSIS_VERSION = "conversation-v2";
    expect(getConversationAnalysisConfig()).toEqual(expect.objectContaining({
      maxInputChars: 80_000,
      requestTimeoutMs: 30_000,
      analysisVersion: "conversation-v2",
    }));
  });
});
