import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GmailSyncJobResult, GmailSyncJobView } from "@/lib/jobs/types";
import {
  MAX_CONSECUTIVE_POLL_FAILURES,
  gmailImportSummaryMessage,
  gmailSyncPresentation,
  gmailSyncUserSummary,
  isActiveGmailSyncStatus,
  isTerminalGmailSyncStatus,
  nextGmailSyncPollingFailure,
} from "./gmail-sync-view";

const timestamp = "2026-07-27T12:00:00.000Z";

function job(
  status: GmailSyncJobView["status"],
  overrides: Partial<GmailSyncJobView> = {},
): GmailSyncJobView {
  return {
    id: "job-a",
    communicationAccountId: "account-a",
    type: "GMAIL_SYNC",
    status,
    progress: null,
    result: null,
    attemptCount: 0,
    maxAttempts: 3,
    availableAt: timestamp,
    queuedAt: timestamp,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    active: isActiveGmailSyncStatus(status),
    ...overrides,
  };
}

function result(
  overrides: Partial<GmailSyncJobResult> = {},
): GmailSyncJobResult {
  return {
    accountsProcessed: 1,
    conversationsProcessed: 4,
    conversationsCreated: 0,
    conversationsUpdated: 4,
    messagesCreated: 0,
    messagesSkipped: 8,
    conversationsMatched: 0,
    conversationsNeedingReview: 0,
    errors: [],
    startedAt: timestamp,
    completedAt: timestamp,
    ...overrides,
  };
}

describe("Gmail sync status presentation", () => {
  it("uses consistent labels and blocks duplicate active jobs", () => {
    for (const status of ["PENDING", "RUNNING", "RETRY_SCHEDULED"] as const) {
      expect(isActiveGmailSyncStatus(status)).toBe(true);
      expect(gmailSyncPresentation({ job: job(status) })).toEqual(
        expect.objectContaining({ active: true, canSubmit: false }),
      );
    }
    expect(gmailSyncPresentation({ job: job("PENDING") }).buttonLabel)
      .toBe("Check queued");
    expect(gmailSyncPresentation({
      job: job("RUNNING", {
        progress: {
          phase: "IMPORTING_THREADS",
          processed: 4,
          total: 10,
          percent: 140,
          message: "Internal progress text.",
        },
      }),
    })).toEqual(expect.objectContaining({
      buttonLabel: "Checking Gmail…",
      message: "Importing recent emails…",
      percent: 100,
    }));
    expect(gmailSyncPresentation({ job: job("RETRY_SCHEDULED") }))
      .toEqual(expect.objectContaining({
        buttonLabel: "Retry scheduled",
        heading: "Gmail check will retry",
        tone: "warning",
      }));
  });

  it("renders the exact successful no-op result without a zero metric table", () => {
    const noOp = result();
    expect(gmailImportSummaryMessage(noOp)).toBe(
      "Gmail is up to date. No new conversations or messages were imported.",
    );
    expect(gmailSyncPresentation({
      job: job("COMPLETED", { result: noOp, completedAt: timestamp }),
    })).toEqual(expect.objectContaining({
      buttonLabel: "Check Gmail",
      heading: "Gmail is up to date",
      tone: "noChanges",
      active: false,
      percent: 100,
      summary: expect.any(Object),
    }));
  });

  it("creates a typed UI summary grouped by activity, review state, and execution", () => {
    expect(gmailSyncUserSummary(result())).toEqual({
      runActivity: {
        newConversations: 0,
        newMessages: 0,
        updatedConversations: 4,
        skippedMessages: 8,
      },
      reviewState: {
        processedConversationsLinked: 0,
        processedConversationsNeedingReview: 0,
        scope: "PROCESSED_IN_THIS_RUN",
      },
      execution: {
        accountsChecked: 1,
        conversationsChecked: 4,
        errorCount: 0,
        startedAt: timestamp,
        completedAt: timestamp,
        durationMs: 0,
      },
    });
  });

  it("distinguishes conversations from individual emails", () => {
    const imported = result({
      conversationsProcessed: 9,
      conversationsCreated: 9,
      conversationsUpdated: 0,
      messagesCreated: 10,
      messagesSkipped: 2,
      conversationsMatched: 2,
      conversationsNeedingReview: 6,
      completedAt: "2026-07-27T12:00:04.000Z",
    });
    expect(gmailImportSummaryMessage(imported)).toBe(
      "Added 9 new conversations and 10 new messages to your Inbox.",
    );
    expect(gmailSyncUserSummary(imported)).toEqual(expect.objectContaining({
      runActivity: expect.objectContaining({
        newConversations: 9,
        newMessages: 10,
      }),
      reviewState: {
        processedConversationsLinked: 2,
        processedConversationsNeedingReview: 6,
        scope: "PROCESSED_IN_THIS_RUN",
      },
      execution: expect.objectContaining({ durationMs: 4_000 }),
    }));

    const oneThread = gmailSyncUserSummary(result({
      conversationsProcessed: 1,
      conversationsCreated: 1,
      conversationsUpdated: 0,
      messagesCreated: 2,
    }));
    expect(oneThread?.runActivity.newConversations).toBe(1);
    expect(oneThread?.runActivity.newMessages).toBe(2);
  });

  it("shows partial success as a warning with a safe retry action", () => {
    const partial = result({
      conversationsCreated: 1,
      messagesCreated: 2,
      errors: [{ code: "THREAD_FAILED", message: "One thread was unavailable." }],
    });
    expect(gmailSyncPresentation({
      job: job("COMPLETED", { result: partial }),
    })).toEqual(expect.objectContaining({
      buttonLabel: "Check Gmail",
      heading: "Gmail check completed with some issues",
      message: expect.stringContaining("Some items could not be checked"),
      tone: "warning",
      canSubmit: true,
    }));
  });

  it("does not describe a missing result as a no-op", () => {
    expect(gmailImportSummaryMessage(null)).toBe(
      "Gmail was checked, but the results are not available.",
    );
    expect(gmailSyncPresentation({ job: job("COMPLETED") })).toEqual(
      expect.objectContaining({
        tone: "warning",
        summary: null,
        message: "Gmail was checked, but the results are not available.",
      }),
    );
  });

  it("renders retry, reconnect, cancelled, and legacy states safely", () => {
    expect(gmailSyncPresentation({
      job: job("FAILED", {
        lastErrorCode: "GMAIL_TEMPORARY",
        lastErrorMessage: "Internal provider wording.",
      }),
    })).toEqual(expect.objectContaining({
      buttonLabel: "Try again",
      heading: "We could not check Gmail",
      message: "Something went wrong while checking Gmail. Please try again.",
      tone: "error",
    }));
    expect(gmailSyncPresentation({
      job: job("FAILED", { lastErrorCode: "GMAIL_RECONNECT_REQUIRED" }),
    })).toEqual(expect.objectContaining({
      buttonLabel: "Reconnect Gmail",
      heading: "Gmail needs to be reconnected",
      canSubmit: false,
      reconnectRequired: true,
    }));
    expect(gmailSyncPresentation({ job: job("CANCELLED") }))
      .toEqual(expect.objectContaining({
        buttonLabel: "Check Gmail",
        heading: "Gmail check cancelled",
      }));
    expect(gmailSyncPresentation({
      job: null,
      fallbackSummary: { conversationsCreated: 0, messagesCreated: 0 },
    }).message).toBe(
      "Gmail is up to date. No new conversations or messages were imported.",
    );
    expect(isTerminalGmailSyncStatus("FAILED")).toBe(true);
    expect(isTerminalGmailSyncStatus("RUNNING")).toBe(false);
  });

  it("bounds polling failures and stops immediately for expired authentication", () => {
    let count = 0;
    for (
      let attempt = 1;
      attempt <= MAX_CONSECUTIVE_POLL_FAILURES;
      attempt++
    ) {
      const failure = nextGmailSyncPollingFailure(count);
      count = failure.count;
      expect(failure.exhausted).toBe(
        attempt === MAX_CONSECUTIVE_POLL_FAILURES,
      );
      expect(failure.authenticationRequired).toBe(false);
    }
    expect(nextGmailSyncPollingFailure(0, 401)).toEqual({
      count: 1,
      exhausted: true,
      authenticationRequired: true,
    });
    expect(nextGmailSyncPollingFailure(0, 403).exhausted).toBe(true);
  });
});

describe("Gmail sync UI integration", () => {
  it("polls safely, preserves the URL, and renders accessible grouped results", () => {
    const source = readFileSync(
      new URL("./gmail-sync-form.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("useActionState");
    expect(source).toContain("POLL_INTERVAL_MS = 5_000");
    expect(source).toContain("/api/jobs/status?accountId=");
    expect(source).toContain('cache: "no-store"');
    expect(source).toContain("isTerminalGmailSyncStatus");
    expect(source).toContain("Gmail status is unavailable");
    expect(source).toContain("window.clearInterval(timer)");
    expect(source).toContain("controller.abort()");
    expect(source).toContain("router.refresh()");
    expect(source).not.toContain("router.push(");
    expect(source).toContain("disabled={disabled}");
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('aria-live={liveError ? "assertive" : "polite"}');
    expect(source).toContain("<details");
    expect(source).toContain("View details");
    expect(source).toContain("Added this check");
    expect(source).toContain("New individual emails");
    expect(source).toContain("Among conversations checked");
    expect(source).toContain("already linked to the same lead");
    expect(source).toContain('variant === "settings"');
    expect(source).toContain("border-l-emerald-500");
    expect(source).toContain("border-l-sky-500");
    expect(source).toContain("border-l-red-500");
  });

  it("loads safe jobs on both surfaces and preserves Inbox conversation context", () => {
    const inbox = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const settings = readFileSync(
      new URL("../settings/page.tsx", import.meta.url),
      "utf8",
    );
    const integrations = readFileSync(
      new URL("../settings/gmail-integrations.tsx", import.meta.url),
      "utf8",
    );

    expect(inbox).toContain("getLatestGmailSyncJob(user.id, gmail.id)");
    expect(inbox).toContain("initialJob={gmailJob}");
    expect(inbox).toContain("const selectedId = one(params.conversation)");
    expect(inbox).toContain("href(params, { conversation: conversation.id })");
    expect(inbox).toContain("href(params, { conversation: undefined })");
    expect(settings).toContain(
      'listRecentJobs(user.id, { type: "GMAIL_SYNC", limit: 100 })',
    );
    expect(settings).toContain("job.communicationAccountId === account.id");
    expect(integrations).toContain("<GmailSyncForm");
    expect(integrations).toContain('variant="settings"');
  });
});
