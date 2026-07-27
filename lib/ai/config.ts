import "server-only";

const DEFAULT_MAX_INPUT_CHARS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_ANALYSIS_VERSION = "conversation-v1";

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function boundedSetting(value: string | undefined, maximum: number) {
  const normalized = value?.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

export type ConversationAnalysisConfig = {
  apiKey: string | null;
  model: string | null;
  maxInputChars: number;
  requestTimeoutMs: number;
  analysisVersion: string;
};

export function getConversationAnalysisConfig(): ConversationAnalysisConfig {
  return {
    apiKey: boundedSetting(process.env.OPENAI_API_KEY, 512),
    model: boundedSetting(
      process.env.OPENAI_CONVERSATION_ANALYSIS_MODEL,
      200,
    ),
    maxInputChars: boundedInteger(
      process.env.AI_ANALYSIS_MAX_INPUT_CHARS,
      DEFAULT_MAX_INPUT_CHARS,
      4_000,
      200_000,
    ),
    requestTimeoutMs: boundedInteger(
      process.env.AI_ANALYSIS_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      5_000,
      120_000,
    ),
    analysisVersion:
      boundedSetting(process.env.AI_ANALYSIS_VERSION, 64) ??
      DEFAULT_ANALYSIS_VERSION,
  };
}

export function conversationAnalysisConfigurationStatus() {
  const config = getConversationAnalysisConfig();
  const missing = [
    !config.apiKey ? "OPENAI_API_KEY" : null,
    !config.model ? "OPENAI_CONVERSATION_ANALYSIS_MODEL" : null,
  ].filter((value): value is string => Boolean(value));
  return {
    available: missing.length === 0,
    message: missing.length
      ? "Conversation analysis is unavailable until the server configuration is completed."
      : "OpenAI is configured for Conversation Intelligence.",
  };
}
