import type { GmailSyncJobView } from "@/lib/jobs/types";

const activeStatuses = new Set(["PENDING", "RUNNING", "RETRY_SCHEDULED"]);
const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export type LegacyImportSummary = {
  conversationsCreated?: number;
  messagesCreated?: number;
};

export type SyncTone =
  | "neutral"
  | "progress"
  | "success"
  | "noChanges"
  | "warning"
  | "error";

export type GmailSyncUserSummary = {
  runActivity: {
    newConversations: number;
    newMessages: number;
    updatedConversations: number;
    skippedMessages: number;
  };
  reviewState: {
    processedConversationsLinked: number;
    processedConversationsNeedingReview: number;
    scope: "PROCESSED_IN_THIS_RUN";
  };
  execution: {
    accountsChecked: number;
    conversationsChecked: number;
    errorCount: number;
    startedAt: string;
    completedAt: string;
    durationMs: number | null;
  };
};

export type GmailSyncPresentation = {
  buttonLabel: string;
  heading: string;
  message: string;
  tone: SyncTone;
  active: boolean;
  canSubmit: boolean;
  reconnectRequired: boolean;
  percent: number | null;
  summary: GmailSyncUserSummary | null;
};

export const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export type GmailSyncPollingFailure = {
  count: number;
  exhausted: boolean;
  authenticationRequired: boolean;
};

export function nextGmailSyncPollingFailure(
  previousCount: number,
  responseStatus?: number,
): GmailSyncPollingFailure {
  const count = Math.min(
    Math.max(0, Math.trunc(previousCount)) + 1,
    MAX_CONSECUTIVE_POLL_FAILURES,
  );
  const authenticationRequired = responseStatus === 401 || responseStatus === 403;
  return {
    count,
    exhausted:
      authenticationRequired || count >= MAX_CONSECUTIVE_POLL_FAILURES,
    authenticationRequired,
  };
}

export function isActiveGmailSyncStatus(status: string | null | undefined) {
  return Boolean(status && activeStatuses.has(status));
}

export function isTerminalGmailSyncStatus(status: string | null | undefined) {
  return Boolean(status && terminalStatuses.has(status));
}

function safeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function durationMs(startedAt: string, completedAt: string) {
  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
  return Math.max(0, completed - started);
}

export function gmailSyncUserSummary(
  result: GmailSyncJobView["result"] | null | undefined,
): GmailSyncUserSummary | null {
  if (!result) return null;
  return {
    runActivity: {
      newConversations: safeCount(result.conversationsCreated),
      newMessages: safeCount(result.messagesCreated),
      updatedConversations: safeCount(result.conversationsUpdated),
      skippedMessages: safeCount(result.messagesSkipped),
    },
    reviewState: {
      processedConversationsLinked: safeCount(result.conversationsMatched),
      processedConversationsNeedingReview: safeCount(
        result.conversationsNeedingReview,
      ),
      scope: "PROCESSED_IN_THIS_RUN",
    },
    execution: {
      accountsChecked: safeCount(result.accountsProcessed),
      conversationsChecked: safeCount(result.conversationsProcessed),
      errorCount: Array.isArray(result.errors) ? result.errors.length : 0,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: durationMs(result.startedAt, result.completedAt),
    },
  };
}

export function gmailImportSummaryMessage(
  result: GmailSyncJobView["result"] | LegacyImportSummary | null | undefined,
) {
  if (!result) {
    return "Gmail was checked, but the results are not available.";
  }
  const conversationsCreated = safeCount(result.conversationsCreated);
  const messagesCreated = safeCount(result.messagesCreated);
  if (conversationsCreated === 0 && messagesCreated === 0) {
    return "Gmail is up to date. No new conversations or messages were imported.";
  }
  return `Added ${conversationsCreated} new conversation${conversationsCreated === 1 ? "" : "s"} and ${messagesCreated} new message${messagesCreated === 1 ? "" : "s"} to your Inbox.`;
}

function hasNewGmailActivity(
  result: GmailSyncJobView["result"] | LegacyImportSummary | null | undefined,
) {
  return Boolean(
    result &&
    (safeCount(result.conversationsCreated) > 0 ||
      safeCount(result.messagesCreated) > 0),
  );
}

function friendlyProgressMessage(
  phase: NonNullable<GmailSyncJobView["progress"]>["phase"] | undefined,
) {
  switch (phase) {
    case "CONNECTING":
      return "Connecting securely to Gmail…";
    case "LISTING_THREADS":
      return "Looking for recent conversations…";
    case "IMPORTING_THREADS":
      return "Importing recent emails…";
    case "MATCHING":
      return "Matching conversations to your leads…";
    case "FINALIZING":
      return "Finishing your Gmail check…";
    default:
      return "Looking for new Gmail activity…";
  }
}

function boundedPercent(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function gmailSyncPresentation({
  job,
  fallbackSummary,
  fallbackError,
}: {
  job: GmailSyncJobView | null;
  fallbackSummary?: LegacyImportSummary | null;
  fallbackError?: string | null;
}): GmailSyncPresentation {
  if (!job) {
    const fallbackHasActivity = hasNewGmailActivity(fallbackSummary);
    return {
      buttonLabel: "Check Gmail",
      heading: fallbackError
        ? "We could not check Gmail"
        : fallbackSummary
          ? fallbackHasActivity
            ? "New Gmail activity added"
            : "Gmail is up to date"
          : "Gmail is connected",
      message: fallbackError
        ? "We could not check Gmail right now. Please try again."
        : fallbackSummary
          ? gmailImportSummaryMessage(fallbackSummary)
          : "Check Gmail to bring recent customer emails into LeadHome.",
      tone: fallbackError
        ? "error"
        : fallbackSummary
          ? fallbackHasActivity
            ? "success"
            : "noChanges"
          : "neutral",
      active: false,
      canSubmit: true,
      reconnectRequired: false,
      percent: null,
      summary: null,
    };
  }

  switch (job.status) {
    case "PENDING":
      return {
        buttonLabel: "Check queued",
        heading: "Gmail check queued",
        message: "Your check will begin shortly.",
        tone: "progress",
        active: true,
        canSubmit: false,
        reconnectRequired: false,
        percent: boundedPercent(job.progress?.percent),
        summary: null,
      };
    case "RUNNING":
      return {
        buttonLabel: "Checking Gmail…",
        heading: "Checking Gmail",
        message: friendlyProgressMessage(job.progress?.phase),
        tone: "progress",
        active: true,
        canSubmit: false,
        reconnectRequired: false,
        percent: boundedPercent(job.progress?.percent),
        summary: null,
      };
    case "RETRY_SCHEDULED":
      return {
        buttonLabel: "Retry scheduled",
        heading: "Gmail check will retry",
        message:
          "Gmail is temporarily unavailable. LeadHome will try again automatically.",
        tone: "warning",
        active: true,
        canSubmit: false,
        reconnectRequired: false,
        percent: boundedPercent(job.progress?.percent),
        summary: null,
      };
    case "COMPLETED": {
      const summary = gmailSyncUserSummary(job.result);
      const hasNewActivity = hasNewGmailActivity(job.result);
      const hasPartialErrors = Boolean(summary?.execution.errorCount);
      return {
        buttonLabel: "Check Gmail",
        heading: hasPartialErrors
          ? "Gmail check completed with some issues"
          : job.result
            ? hasNewActivity
              ? "New Gmail activity added"
              : "Gmail is up to date"
            : "Gmail check finished",
        message: hasPartialErrors
          ? hasNewActivity
            ? `${gmailImportSummaryMessage(job.result)} Some items could not be checked; try again to finish.`
            : "Some Gmail items could not be checked. Try again to finish the check."
          : gmailImportSummaryMessage(job.result),
        tone: hasPartialErrors
          ? "warning"
          : job.result
            ? hasNewActivity
              ? "success"
              : "noChanges"
            : "warning",
        active: false,
        canSubmit: true,
        reconnectRequired: false,
        percent: 100,
        summary,
      };
    }
    case "FAILED": {
      const reconnectRequired = job.lastErrorCode === "GMAIL_RECONNECT_REQUIRED";
      return {
        buttonLabel: reconnectRequired ? "Reconnect Gmail" : "Try again",
        heading: reconnectRequired
          ? "Gmail needs to be reconnected"
          : "We could not check Gmail",
        message: reconnectRequired
          ? "Reconnect Gmail to continue importing customer emails."
          : "Something went wrong while checking Gmail. Please try again.",
        tone: "error",
        active: false,
        canSubmit: !reconnectRequired,
        reconnectRequired,
        percent: null,
        summary: null,
      };
    }
    case "CANCELLED":
      return {
        buttonLabel: "Check Gmail",
        heading: "Gmail check cancelled",
        message: "No Gmail changes were imported.",
        tone: "neutral",
        active: false,
        canSubmit: true,
        reconnectRequired: false,
        percent: null,
        summary: null,
      };
    default:
      return {
        buttonLabel: "Check Gmail",
        heading: "Gmail is connected",
        message: "Check Gmail to bring recent customer emails into LeadHome.",
        tone: "neutral",
        active: false,
        canSubmit: true,
        reconnectRequired: false,
        percent: null,
        summary: null,
      };
  }
}
