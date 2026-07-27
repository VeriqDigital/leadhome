import { describe, expect, it } from "vitest";
import { conversationAnalysisConfigurationStatus } from "@/lib/ai/config";
import { OpenAIConversationAnalysisProvider } from "./provider";

const liveSmokeEnabled = process.env.RUN_OPENAI_SMOKE_TEST === "true";

describe.skipIf(!liveSmokeEnabled)("OpenAI Conversation Intelligence smoke", () => {
  it(
    "parses a synthetic business conversation without printing its content",
    async () => {
      expect(conversationAnalysisConfigurationStatus().available).toBe(true);
      const provider = new OpenAIConversationAnalysisProvider();
      const result = await provider.analyze({
        includedMessageCount: 2,
        timeoutMs: 45_000,
        text: [
          "Analysis input version: conversation-v1",
          "Subject: Website redesign inquiry",
          "Participants: Jordan Lee <jordan@example.test>, Studio <sales@example.test>",
          "",
          "M1",
          "Direction: INBOUND",
          "Timestamp: 2026-07-27T14:00:00.000Z",
          "From: Jordan Lee <jordan@example.test>",
          "To: Studio <sales@example.test>",
          "Body:",
          "We need a website redesign. Our stated budget is USD 12,000 to 15,000, and we need a proposal by August 5, 2026.",
          "",
          "M2",
          "Direction: OUTBOUND",
          "Timestamp: 2026-07-27T15:00:00.000Z",
          "From: Studio <sales@example.test>",
          "To: Jordan Lee <jordan@example.test>",
          "Body:",
          "Thanks. We will review the scope and send a proposal.",
        ].join("\n"),
      });

      expect(result.model.length).toBeGreaterThan(0);
      expect(result.analysis.summary.length).toBeGreaterThan(0);
      expect(result.analysis.budget.minimumAmount).toBe(12_000);
      expect(result.analysis.budget.maximumAmount).toBe(15_000);
    },
    120_000,
  );
});
