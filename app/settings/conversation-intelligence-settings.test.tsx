import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Conversation Intelligence Settings surface", () => {
  it("renders the opt-in, privacy boundary, and safe configuration state", () => {
    const source = readFileSync(
      new URL("./conversation-intelligence-settings.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Conversation Intelligence");
    expect(source).toContain("configured OpenAI API");
    expect(source).toContain("Attachments are not included");
    expect(source).toContain("does not scan or");
    expect(source).toContain("backfill your existing inbox");
    expect(source).toContain("AI provider is ready");
    expect(source).toContain("AI provider setup is incomplete");
    expect(source).toContain("Latest successful analysis");
    expect(source).toContain("useActionState");
    expect(source).toContain("disabled={pending || enablingBlocked}");
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("OPENAI_CONVERSATION_ANALYSIS_MODEL");
  });

  it("loads only safe server-derived values on the existing Settings page", () => {
    const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(page).toContain("<ConversationIntelligenceSettings");
    expect(page).toContain("conversationIntelligenceEnabled: true");
    expect(page).toContain("conversationAnalysisConfigurationStatus()");
    expect(page).toContain("latestSuccessfulConversationAnalysisAt(user.id)");
    expect(page).not.toContain("OPENAI_API_KEY");
  });
});
