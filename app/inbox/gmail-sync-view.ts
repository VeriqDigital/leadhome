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

export type GmailSyncPresentation = {
  buttonLabel: string;
  heading: string;
  message: string;
  tone: SyncTone;
  active: boolean;
  canSubmit: boolean;
  reconnectRequired: boolean;
  percent: number | null;
  summary: GmailSyncSummaryMetric[];
};

export type GmailSyncSummaryMetric = {
  label: string;
  value: number;
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

export function gmailImportSummaryMessage(
  result: GmailSyncJobView["result"] | LegacyImportSummary | null | undefined,
) {
  if (!result) {
    return "Gmail was checked, but the results are not available.";
  }
  const conversationsCreated = safeCount(result?.conversationsCreated);
  const messagesCreated = safeCount(result?.messagesCreated);
  if (conversationsCreated === 0 && messagesCreated === 0) {
    return "We checked Gmail and did not find any new conversations or messages.";
  }
  return `We added ${conversationsCreated} new conversation${conversationsCreated === 1 ? "" : "s"} and ${messagesCreated} new message${messagesCreated === 1 ? "" : "s"} to your inbox.`;
}

export function gmailImportSummaryMetrics(
  result: GmailSyncJobView["result"] | null | undefined,
): GmailSyncSummaryMetric[] {
  if (!result) return [];
  return [
    {
      label: "New conversations",
      value: safeCount(result.conversationsCreated),
    },
    { label: "New messages", value: safeCount(result.messagesCreated) },
    {
      label: "Linked to leads",
      value: safeCount(result.conversationsMatched),
    },
    {
      label: "Needs review",
      value: safeCount(result.conversationsNeedingReview),
    },
  ];
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
      return "Connecting to Gmail…";
    case "LISTING_THREADS":
      return "Looking for recent conversations…";
    case "IMPORTING_THREADS":
      return "Bringing in recent messages…";
    case "MATCHING":
      return "Linking conversations to your leads…";
    case "FINALIZING":
      return "Finishing up…";
    default:
      return "Checking for new Gmail activity…";
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
            : "Everything is up to date"
          : "Gmail is connected",
      message: fallbackError
        ? "We could not check Gmail right now. Please try again."
        : fallbackSummary
          ? gmailImportSummaryMessage(fallbackSummary)
          : "Check Gmail whenever you want to bring new customer messages into LeadHome.",
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
      summary: [],
    };
  }

  switch (job.status) {
    case "PENDING":
      return {
        buttonLabel: "Waiting…",
        heading: "Waiting to check Gmail",
        message: "Your Gmail check will start shortly.",
        tone: "progress",
        active: true,
        canSubmit: false,
        reconnectRequired: false,
        percent: boundedPercent(job.progress?.percent),
        summary: [],
      };
    case "RUNNING":
      return {
        buttonLabel: "Checking…",
        heading: "Checking Gmail",
        message: friendlyProgressMessage(job.progress?.phase),
        tone: "progress",
        active: true,
        canSubmit: false,
        reconnectRequired: false,
        percent: boundedPercent(job.progress?.percent),
        summary: [],
      };
    case "RETRY_SCHEDULED":
      return {
        buttonLabel: "Trying again soon",
        heading: "We will try again shortly",
        message:
          "Gmail is temporarily unavailable. You do not need to do anything.",
        tone: "warning",
        active: true,
        canSubmit: false,
        reconnectRequired: false,
        percent: boundedPercent(job.progress?.percent),
        summary: [],
      };
    case "COMPLETED": {
      const hasNewActivity = hasNewGmailActivity(job.result);
      return {
        buttonLabel: "Check Gmail",
        heading: job.result
          ? hasNewActivity
            ? "New Gmail activity added"
            : "Everything is up to date"
          : "Gmail check finished",
        message: gmailImportSummaryMessage(job.result),
        tone: job.result
          ? hasNewActivity
            ? "success"
            : "noChanges"
          : "warning",
        active: false,
        canSubmit: true,
        reconnectRequired: false,
        percent: 100,
        summary: hasNewActivity
          ? gmailImportSummaryMetrics(job.result)
          : [],
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
          ? "Reconnect Gmail to continue bringing customer messages into LeadHome."
          : "Something went wrong while checking Gmail. Please try again.",
        tone: "error",
        active: false,
        canSubmit: !reconnectRequired,
        reconnectRequired,
        percent: null,
        summary: [],
      };
    }
    case "CANCELLED":
      return {
        buttonLabel: "Check Gmail",
        heading: "Gmail check cancelled",
        message: "No changes were made.",
        tone: "neutral",
        active: false,
        canSubmit: true,
        reconnectRequired: false,
        percent: null,
        summary: [],
      };
    default:
      return {
        buttonLabel: "Check Gmail",
        heading: "Gmail is connected",
        message: "Check Gmail to bring new customer messages into LeadHome.",
        tone: "neutral",
        active: false,
        canSubmit: true,
        reconnectRequired: false,
        percent: null,
        summary: [],
      };
  }
}
