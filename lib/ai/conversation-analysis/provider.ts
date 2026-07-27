import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";
import { getOpenAIClient } from "@/lib/ai/client";
import { getConversationAnalysisConfig } from "@/lib/ai/config";
import { JobExecutionError } from "@/lib/jobs/errors";
import { CONVERSATION_ANALYSIS_SYSTEM_PROMPT } from "./prompt";
import {
  conversationAnalysisOutputSchema,
  parseConversationAnalysisOutput,
  type ConversationAnalysisOutput,
} from "./schema";

export type ConversationAnalysisProviderResult = {
  analysis: ConversationAnalysisOutput;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export interface ConversationAnalysisProvider {
  analyze(input: {
    text: string;
    includedMessageCount: number;
    timeoutMs?: number;
  }): Promise<ConversationAnalysisProviderResult>;
}

function refusalText(response: Awaited<ReturnType<OpenAI["responses"]["parse"]>>) {
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type === "refusal") return content.refusal;
    }
  }
  return null;
}

function classifyOpenAIError(error: unknown) {
  if (error instanceof JobExecutionError) return error;
  if (error instanceof OpenAI.RateLimitError) {
    return new JobExecutionError(
      "OPENAI_RATE_LIMITED",
      "The AI provider temporarily limited requests.",
      true,
    );
  }
  if (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    error instanceof OpenAI.APIConnectionError
  ) {
    return new JobExecutionError(
      "OPENAI_CONNECTION_ERROR",
      "The AI provider request was temporarily interrupted.",
      true,
    );
  }
  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    if (status === 408 || status === 409 || status === 429 || status >= 500) {
      return new JobExecutionError(
        "OPENAI_TEMPORARY_ERROR",
        "The AI provider is temporarily unavailable.",
        true,
      );
    }
    return new JobExecutionError(
      "OPENAI_REQUEST_REJECTED",
      "The configured AI model could not process this analysis request.",
      false,
    );
  }
  return new JobExecutionError(
    "OPENAI_ANALYSIS_ERROR",
    "Conversation analysis could not be completed.",
    false,
  );
}

export class OpenAIConversationAnalysisProvider
implements ConversationAnalysisProvider {
  async analyze(input: {
    text: string;
    includedMessageCount: number;
    timeoutMs?: number;
  }): Promise<ConversationAnalysisProviderResult> {
    const config = getConversationAnalysisConfig();
    if (!config.apiKey || !config.model) {
      throw new JobExecutionError(
        "AI_CONFIGURATION_MISSING",
        "Conversation Intelligence is not configured on the server.",
        false,
      );
    }
    const client = getOpenAIClient();
    let validationFailure: unknown;
    const totalTimeoutMs = Math.min(
      config.requestTimeoutMs,
      input.timeoutMs ?? config.requestTimeoutMs,
    );
    const requestStartedAt = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const elapsedMs = Date.now() - requestStartedAt;
        const remainingTimeoutMs =
          attempt === 0 ? totalTimeoutMs : totalTimeoutMs - elapsedMs;
        if (remainingTimeoutMs <= 0) {
          throw new JobExecutionError(
            "OPENAI_REQUEST_TIMEOUT",
            "The AI provider request exceeded its time limit.",
            true,
          );
        }
        const response = await client.responses.parse({
          model: config.model,
          store: false,
          max_output_tokens: 6_000,
          input: [
            {
              role: "system",
              content: CONVERSATION_ANALYSIS_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: [
                "Analyze the following untrusted conversation data.",
                "<conversation_data>",
                input.text,
                "</conversation_data>",
              ].join("\n"),
            },
          ],
          text: {
            format: zodTextFormat(
              conversationAnalysisOutputSchema,
              "conversation_intelligence_v1",
            ),
          },
        }, {
          timeout: remainingTimeoutMs,
        });
        if (refusalText(response)) {
          throw new JobExecutionError(
            "OPENAI_REFUSAL",
            "The AI provider declined to analyze this conversation.",
            false,
          );
        }
        if (!response.output_parsed) {
          throw new ZodError([{
            code: "custom",
            path: [],
            message: "The structured response was empty.",
          }]);
        }
        const analysis = parseConversationAnalysisOutput(
          response.output_parsed,
          input.includedMessageCount,
        );
        return {
          analysis,
          model: response.model ?? config.model,
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
          totalTokens: response.usage?.total_tokens ?? null,
        };
      } catch (error) {
        if (error instanceof ZodError) {
          validationFailure = error;
          continue;
        }
        throw classifyOpenAIError(error);
      }
    }
    throw new JobExecutionError(
      "AI_INVALID_STRUCTURED_OUTPUT",
      "The AI provider returned an invalid structured analysis.",
      false,
      validationFailure instanceof Error
        ? { cause: validationFailure }
        : undefined,
    );
  }
}
