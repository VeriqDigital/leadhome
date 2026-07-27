import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationAnalysisOutput } from "./schema";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  getClient: vi.fn(),
  config: vi.fn(),
}));

vi.mock("@/lib/ai/client", () => ({
  getOpenAIClient: mocks.getClient,
}));
vi.mock("@/lib/ai/config", () => ({
  getConversationAnalysisConfig: mocks.config,
}));

import { OpenAIConversationAnalysisProvider } from "./provider";

function validOutput(): ConversationAnalysisOutput {
  return {
    summary: "A prospect asked for a website redesign proposal.",
    company: {
      value: null,
      confidence: 0,
      evidenceMessageOrdinals: [],
    },
    contact: {
      name: "Alex",
      email: "alex@example.com",
      phone: null,
      confidence: 0.9,
      evidenceMessageOrdinals: [1],
    },
    projectType: {
      value: "Website redesign",
      confidence: 0.95,
      evidenceMessageOrdinals: [1],
    },
    budget: {
      minimumAmount: null,
      maximumAmount: null,
      currency: null,
      rawText: null,
      confidence: 0,
      evidenceMessageOrdinals: [],
    },
    timeline: {
      targetDate: null,
      rawText: null,
      confidence: 0,
      evidenceMessageOrdinals: [],
    },
    sentiment: {
      value: "NEUTRAL",
      confidence: 0.7,
    },
    actionItems: [],
    missingInformation: ["Budget"],
  };
}

function response(output = validOutput()) {
  return {
    output: [],
    output_parsed: output,
    model: "provider-model",
    usage: {
      input_tokens: 900,
      output_tokens: 150,
      total_tokens: 1_050,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({
    apiKey: "test-key",
    model: "configured-model",
    maxInputChars: 60_000,
    requestTimeoutMs: 45_000,
    analysisVersion: "conversation-v1",
  });
  mocks.getClient.mockReturnValue({
    responses: { parse: mocks.parse },
  });
  mocks.parse.mockResolvedValue(response());
});

describe("OpenAI conversation analysis provider", () => {
  it("uses strict non-stored Responses output and returns bounded usage", async () => {
    const provider = new OpenAIConversationAnalysisProvider();

    await expect(provider.analyze({
      text: "M1\nBody:\nPlease send a proposal.",
      includedMessageCount: 1,
      timeoutMs: 20_000,
    })).resolves.toEqual({
      analysis: validOutput(),
      model: "provider-model",
      inputTokens: 900,
      outputTokens: 150,
      totalTokens: 1_050,
    });

    expect(mocks.parse).toHaveBeenCalledOnce();
    expect(mocks.parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "configured-model",
        store: false,
        max_output_tokens: 6_000,
        text: {
          format: expect.any(Object),
        },
      }),
      { timeout: 20_000 },
    );
    const request = mocks.parse.mock.calls[0][0];
    expect(request.text.format).toEqual(
      expect.objectContaining({
        type: "json_schema",
        name: "conversation_intelligence_v1",
        strict: true,
        schema: expect.objectContaining({
          type: "object",
          additionalProperties: false,
        }),
      }),
    );
    expect(request.input[0]).toEqual(expect.objectContaining({
      role: "system",
    }));
    expect(request.input[1]).toEqual(expect.objectContaining({
      role: "user",
      content: expect.stringContaining("<conversation_data>"),
    }));
  });

  it("allows exactly one immediate retry for invalid structured output", async () => {
    mocks.parse
      .mockResolvedValueOnce({
        ...response(),
        output_parsed: null,
      })
      .mockResolvedValueOnce(response());

    await expect(new OpenAIConversationAnalysisProvider().analyze({
      text: "bounded input",
      includedMessageCount: 1,
    })).resolves.toEqual(expect.objectContaining({
      analysis: validOutput(),
    }));
    expect(mocks.parse).toHaveBeenCalledTimes(2);

    mocks.parse.mockReset();
    mocks.parse.mockResolvedValue({
      ...response(),
      output_parsed: null,
    });
    await expect(new OpenAIConversationAnalysisProvider().analyze({
      text: "bounded input",
      includedMessageCount: 1,
    })).rejects.toMatchObject({
      code: "AI_INVALID_STRUCTURED_OUTPUT",
      retryable: false,
    });
    expect(mocks.parse).toHaveBeenCalledTimes(2);
  });

  it("treats out-of-range evidence as invalid structured output", async () => {
    const invalid = validOutput();
    invalid.contact.evidenceMessageOrdinals = [2];
    mocks.parse.mockResolvedValue(response(invalid));

    await expect(new OpenAIConversationAnalysisProvider().analyze({
      text: "M1 only",
      includedMessageCount: 1,
    })).rejects.toMatchObject({
      code: "AI_INVALID_STRUCTURED_OUTPUT",
      retryable: false,
    });
    expect(mocks.parse).toHaveBeenCalledTimes(2);
  });

  it("fails safely before client creation when provider configuration is missing", async () => {
    mocks.config.mockReturnValueOnce({
      apiKey: null,
      model: null,
      maxInputChars: 60_000,
      requestTimeoutMs: 45_000,
      analysisVersion: "conversation-v1",
    });

    await expect(new OpenAIConversationAnalysisProvider().analyze({
      text: "bounded input",
      includedMessageCount: 1,
    })).rejects.toMatchObject({
      code: "AI_CONFIGURATION_MISSING",
      retryable: false,
      safeMessage:
        "Conversation Intelligence is not configured on the server.",
    });
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it("handles model refusals as a permanent safe failure", async () => {
    mocks.parse.mockResolvedValueOnce({
      output: [{
        type: "message",
        content: [{
          type: "refusal",
          refusal: "Provider refusal detail that must not be surfaced.",
        }],
      }],
      output_parsed: null,
      model: "provider-model",
      usage: null,
    });

    await expect(new OpenAIConversationAnalysisProvider().analyze({
      text: "bounded input",
      includedMessageCount: 1,
    })).rejects.toMatchObject({
      code: "OPENAI_REFUSAL",
      retryable: false,
      safeMessage:
        "The AI provider declined to analyze this conversation.",
    });
    expect(mocks.parse).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: "rate limit",
      error: () => new OpenAI.RateLimitError(
        429,
        { message: "raw provider rate-limit detail" },
        undefined,
        new Headers(),
      ),
      code: "OPENAI_RATE_LIMITED",
      retryable: true,
    },
    {
      label: "connection timeout",
      error: () => new OpenAI.APIConnectionTimeoutError(),
      code: "OPENAI_CONNECTION_ERROR",
      retryable: true,
    },
    {
      label: "provider 5xx",
      error: () => new OpenAI.InternalServerError(
        503,
        { message: "raw provider outage detail" },
        undefined,
        new Headers(),
      ),
      code: "OPENAI_TEMPORARY_ERROR",
      retryable: true,
    },
    {
      label: "bad request",
      error: () => new OpenAI.BadRequestError(
        400,
        { message: "raw provider rejection detail" },
        undefined,
        new Headers(),
      ),
      code: "OPENAI_REQUEST_REJECTED",
      retryable: false,
    },
    {
      label: "unexpected local error",
      error: () => new Error("raw unexpected detail"),
      code: "OPENAI_ANALYSIS_ERROR",
      retryable: false,
    },
  ])(
    "classifies $label without leaking raw provider details",
    async ({ error, code, retryable }) => {
      mocks.parse.mockRejectedValueOnce(error());

      const rejection = new OpenAIConversationAnalysisProvider().analyze({
        text: "bounded input",
        includedMessageCount: 1,
      });
      await expect(rejection).rejects.toMatchObject({ code, retryable });
      await expect(rejection).rejects.not.toMatchObject({
        safeMessage: expect.stringContaining("raw"),
      });
    },
  );
});
