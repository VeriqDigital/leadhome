import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GmailSyncJobView } from "@/lib/jobs/types";
import {
  MAX_CONSECUTIVE_POLL_FAILURES,
  gmailImportSummaryMetrics,
  gmailImportSummaryMessage,
  gmailSyncPresentation,
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

describe("Gmail sync status presentation", () => {
  it("treats queued, running, and scheduled retries as duplicate-blocking active jobs", () => {
    for (const status of ["PENDING", "RUNNING", "RETRY_SCHEDULED"] as const) {
      expect(isActiveGmailSyncStatus(status)).toBe(true);
      expect(gmailSyncPresentation({ job: job(status) })).toEqual(
        expect.objectContaining({ active: true, canSubmit: false }),
      );
    }
    expect(gmailSyncPresentation({ job: job("PENDING") }).buttonLabel)
      .toBe("Waiting…");
    expect(gmailSyncPresentation({
      job: job("RUNNING", {
        progress: {
          phase: "IMPORTING_THREADS",
          processed: 4,
          total: 10,
          percent: 140,
          message: "Importing conversations.",
        },
      }),
    })).toEqual(expect.objectContaining({
      buttonLabel: "Checking…",
      message: "Bringing in recent messages…",
      percent: 100,
    }));
    expect(gmailSyncPresentation({ job: job("RETRY_SCHEDULED") }))
      .toEqual(expect.objectContaining({
        buttonLabel: "Trying again soon",
        heading: "We will try again shortly",
        tone: "warning",
      }));
  });

  it("renders completed summaries, including the exact no-op result", () => {
    const noOp = {
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
    };
    expect(gmailImportSummaryMessage(noOp)).toBe(
      "We checked Gmail and did not find any new conversations or messages.",
    );
    expect(gmailSyncPresentation({
      job: job("COMPLETED", { result: noOp, completedAt: timestamp }),
    })).toEqual(expect.objectContaining({
      buttonLabel: "Check Gmail",
      heading: "Everything is up to date",
      tone: "noChanges",
      active: false,
      percent: 100,
      summary: [],
    }));
    expect(gmailImportSummaryMetrics(noOp)).toEqual([
      { label: "New conversations", value: 0 },
      { label: "New messages", value: 0 },
      { label: "Linked to leads", value: 0 },
      { label: "Needs review", value: 0 },
    ]);

    const imported = {
      ...noOp,
      conversationsCreated: 1,
      messagesCreated: 3,
    };
    expect(gmailImportSummaryMessage(imported)).toBe(
      "We added 1 new conversation and 3 new messages to your inbox.",
    );
    expect(gmailSyncPresentation({
      job: job("COMPLETED", { result: imported }),
    })).toEqual(expect.objectContaining({
      heading: "New Gmail activity added",
      tone: "success",
    }));
  });

  it("does not describe a completed job with a missing result as a no-op", () => {
    expect(gmailImportSummaryMessage(null)).toBe(
      "Gmail was checked, but the results are not available.",
    );
    expect(gmailSyncPresentation({ job: job("COMPLETED") })).toEqual(
      expect.objectContaining({
        tone: "warning",
        summary: [],
        message: "Gmail was checked, but the results are not available.",
      }),
    );
  });

  it("renders safe retry, cancelled, and legacy states without exposing internals", () => {
    expect(gmailSyncPresentation({
      job: job("FAILED", {
        lastErrorCode: "GMAIL_TEMPORARY",
        lastErrorMessage: "Gmail is temporarily unavailable. Please try again.",
      }),
    })).toEqual(expect.objectContaining({
      buttonLabel: "Try again",
      heading: "We could not check Gmail",
      message: "Something went wrong while checking Gmail. Please try again.",
      tone: "error",
    }));
    expect(gmailSyncPresentation({
      job: job("FAILED", {
        lastErrorCode: "GMAIL_RECONNECT_REQUIRED",
        lastErrorMessage: "Reconnect Gmail to continue.",
      }),
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
    }).message).toContain("did not find any new");
    expect(isTerminalGmailSyncStatus("FAILED")).toBe(true);
    expect(isTerminalGmailSyncStatus("RUNNING")).toBe(false);
  });

  it("bounds consecutive polling failures and stops immediately for expired authentication", () => {
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
  it("uses action state, focused five-second polling, and stops after terminal status", () => {
    const source = readFileSync(
      new URL("./gmail-sync-form.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("useActionState");
    expect(source).toContain("POLL_INTERVAL_MS = 5_000");
    expect(source).toContain("/api/jobs/status?accountId=");
    expect(source).toContain('cache: "no-store"');
    expect(source).toContain("isTerminalGmailSyncStatus");
    expect(source).toContain("nextGmailSyncPollingFailure");
    expect(source).toContain("Gmail status is unavailable");
    expect(source).toContain("Check status");
    expect(source).toContain("window.clearInterval(timer)");
    expect(source).toContain("controller.abort()");
    expect(source).toContain("router.refresh()");
    expect(source).not.toContain("router.push(");
    expect(source).toContain("disabled={disabled}");
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('aria-live={liveError ? "assertive" : "polite"}');
    expect(source).toContain("<dl");
    expect(source).toContain("bg-emerald-50");
    expect(source).toContain("bg-sky-50");
    expect(source).toContain("bg-red-50");
  });

  it("loads safe jobs on both surfaces and preserves the Inbox conversation URL", () => {
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
    expect(settings).toContain("take: 100");
    expect(integrations).toContain("<GmailSyncForm");
    expect(integrations).toContain("initialJob={account.latestJob}");
  });
});
