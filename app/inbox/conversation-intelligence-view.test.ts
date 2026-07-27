import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversationIntelligenceView } from "@/lib/ai/conversation-analysis/view-service";
import type { ConversationAnalysisJobView } from "@/lib/jobs/types";
import {
  MAX_CONVERSATION_ANALYSIS_POLL_FAILURES,
  conversationIntelligencePresentation,
  isActiveConversationAnalysisStatus,
  isTerminalConversationAnalysisStatus,
  nextConversationAnalysisPollingFailure,
} from "./conversation-intelligence-view";

const timestamp = "2026-07-27T12:00:00.000Z";

function job(
  status: ConversationAnalysisJobView["status"],
): ConversationAnalysisJobView {
  return {
    id: "job-a",
    type: "CONVERSATION_ANALYSIS",
    status,
    progress: null,
    result: null,
    attemptCount: 1,
    maxAttempts: 3,
    availableAt: timestamp,
    queuedAt: timestamp,
    startedAt: status === "RUNNING" ? timestamp : null,
    completedAt: status === "COMPLETED" ? timestamp : null,
    failedAt: status === "FAILED" ? timestamp : null,
    lastErrorCode: null,
    lastErrorMessage: null,
    updatedAt: timestamp,
    active: isActiveConversationAnalysisStatus(status),
  };
}

function view(
  overrides: Partial<ConversationIntelligenceView> = {},
): ConversationIntelligenceView {
  return {
    enabled: true,
    configuration: {
      available: true,
      message: "OpenAI is configured for Conversation Intelligence.",
    },
    analysis: null,
    job: null,
    ...overrides,
  };
}

const output = {
  summary: "The contact requested a project proposal.",
  company: {
    value: "Acme",
    confidence: 0.9,
    evidenceMessageOrdinals: [1],
  },
  contact: {
    name: "Jamie",
    email: "jamie@example.com",
    phone: null,
    confidence: 0.9,
    evidenceMessageOrdinals: [1],
  },
  projectType: {
    value: "Website",
    confidence: 0.8,
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
  sentiment: { value: "POSITIVE" as const, confidence: 0.8 },
  actionItems: [],
  missingInformation: [],
};

describe("Conversation Intelligence presentation", () => {
  it("keeps disabled and configuration-unavailable states non-actionable", () => {
    expect(conversationIntelligencePresentation({
      view: view({
        enabled: false,
        configuration: { available: false, message: "Unavailable." },
      }),
      job: null,
    })).toEqual(expect.objectContaining({
      kind: "disabled",
      canAnalyze: false,
      buttonLabel: null,
    }));
    expect(conversationIntelligencePresentation({
      view: view({
        configuration: { available: false, message: "Unavailable." },
      }),
      job: null,
    })).toEqual(expect.objectContaining({
      kind: "unavailable",
      message: "Unavailable.",
      canAnalyze: false,
    }));
  });

  it("shows exact not-analyzed, queued, and running actions", () => {
    expect(conversationIntelligencePresentation({
      view: view(),
      job: null,
    })).toEqual(expect.objectContaining({
      kind: "not-analyzed",
      buttonLabel: "Analyze conversation",
      canAnalyze: true,
    }));
    expect(conversationIntelligencePresentation({
      view: view(),
      job: job("PENDING"),
    })).toEqual(expect.objectContaining({
      kind: "queued",
      buttonLabel: "Analysis queued",
      active: true,
    }));
    expect(conversationIntelligencePresentation({
      view: view(),
      job: job("RUNNING"),
    })).toEqual(expect.objectContaining({
      kind: "running",
      buttonLabel: "Analyzing…",
      active: true,
    }));
  });

  it("supports completed, failed, cancelled, and skipped recovery states", () => {
    const completed = view({
      analysis: {
        id: "analysis-a",
        status: "COMPLETED",
        output,
        outputInvalid: false,
        inputTruncated: false,
        completedAt: timestamp,
        updatedAt: timestamp,
      },
    });
    expect(conversationIntelligencePresentation({
      view: completed,
      job: job("COMPLETED"),
    })).toEqual(expect.objectContaining({
      kind: "completed",
      buttonLabel: "Reanalyze",
      canAnalyze: true,
    }));

    for (const [status, kind] of [
      ["FAILED", "failed"],
      ["CANCELLED", "cancelled"],
      ["SKIPPED", "skipped"],
    ] as const) {
      expect(conversationIntelligencePresentation({
        view: view({
          analysis: {
            ...completed.analysis!,
            status,
          },
        }),
        job: status === "SKIPPED" ? null : job(status),
      })).toEqual(expect.objectContaining({
        kind,
        buttonLabel: "Try analysis again",
        canAnalyze: true,
      }));
    }
  });

  it("fails closed when completed structured output was not strictly valid", () => {
    expect(conversationIntelligencePresentation({
      view: view({
        analysis: {
          id: "analysis-a",
          status: "COMPLETED",
          output: null,
          outputInvalid: true,
          inputTruncated: false,
          completedAt: timestamp,
          updatedAt: timestamp,
        },
      }),
      job: null,
    })).toEqual(expect.objectContaining({
      kind: "failed",
      heading: "Saved analysis is unavailable",
      buttonLabel: "Try analysis again",
    }));
  });

  it("uses the existing bounded polling failure policy", () => {
    let count = 0;
    for (
      let attempt = 1;
      attempt <= MAX_CONVERSATION_ANALYSIS_POLL_FAILURES;
      attempt++
    ) {
      const failure = nextConversationAnalysisPollingFailure(count);
      count = failure.count;
      expect(failure.exhausted).toBe(
        attempt === MAX_CONVERSATION_ANALYSIS_POLL_FAILURES,
      );
    }
    expect(nextConversationAnalysisPollingFailure(0, 401)).toEqual({
      count: 1,
      exhausted: true,
      authenticationRequired: true,
    });
    expect(nextConversationAnalysisPollingFailure(0, 403).exhausted)
      .toBe(true);
    expect(isActiveConversationAnalysisStatus("RETRY_SCHEDULED")).toBe(true);
    expect(isTerminalConversationAnalysisStatus("CANCELLED")).toBe(true);
  });
});

describe("Conversation Intelligence Inbox integration", () => {
  it("polls the exact job, preserves URL state, and limits live announcements", () => {
    const source = readFileSync(
      new URL("./conversation-intelligence-card.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("POLL_INTERVAL_MS = 5_000");
    expect(source).toContain(
      "/api/jobs/conversation-analysis/status?jobId=",
    );
    expect(source).toContain('cache: "no-store"');
    expect(source).toContain("window.clearInterval(timer)");
    expect(source).toContain("controller.abort()");
    expect(source).toContain("router.refresh()");
    expect(source).not.toContain("router.push(");
    // One lifecycle announcement and one visually hidden clipboard result.
    expect(source.match(/aria-live=/g)).toHaveLength(2);
    expect(source).toContain(
      "/tasks/new?analysis=${encodeURIComponent(analysis.id)}&item=${index}",
    );
    expect(source).toContain("sm:grid-cols-2");
    expect(source).toContain('aria-expanded={summaryExpanded}');
    expect(source).toContain('aria-expanded={missingExpanded}');
    expect(source).toContain("Information to clarify");
    expect(source).toContain("validEmailHref(output.contact.email)");
    expect(source).toContain("validPhoneHref(output.contact.phone)");
    expect(source).toContain("sentimentClasses[output.sentiment.value]");
    expect(source).toContain('copy("summary", output.summary)');
    expect(source).not.toContain("openai");
  });

  it("uses owner-scoped reads and strict stored-output parsing", () => {
    const source = readFileSync(
      new URL(
        "../../lib/ai/conversation-analysis/view-service.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("where: { id: conversationId, ownerId }");
    expect(source).toContain("conversationAnalysisOutputSchema.safeParse");
    expect(source).toContain("conversation.analysis.latestJobId");
    expect(source).toContain("getConversationAnalysisJob(");
  });

  it("places the card between conversation controls and open tasks", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const controls = source.indexOf("<ConversationControls");
    const intelligence = source.indexOf("<ConversationIntelligenceCard");
    const tasks = source.indexOf("Open tasks");
    expect(controls).toBeGreaterThan(-1);
    expect(intelligence).toBeGreaterThan(controls);
    expect(tasks).toBeGreaterThan(intelligence);
  });
});
