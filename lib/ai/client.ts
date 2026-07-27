import "server-only";

import OpenAI from "openai";
import { getConversationAnalysisConfig } from "./config";

let client: OpenAI | null = null;
let clientKey: string | null = null;

export function getOpenAIClient() {
  const config = getConversationAnalysisConfig();
  if (!config.apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  if (!client || clientKey !== config.apiKey) {
    client = new OpenAI({
      apiKey: config.apiKey,
      timeout: config.requestTimeoutMs,
      // Job retries own transient retry policy. Disable SDK retries so they do
      // not multiply with the queue's bounded attempts.
      maxRetries: 0,
    });
    clientKey = config.apiKey;
  }
  return client;
}
