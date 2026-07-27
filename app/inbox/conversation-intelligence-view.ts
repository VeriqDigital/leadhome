import type { ConversationAnalysisJobView } from "@/lib/jobs/types";
import type { ConversationIntelligenceView } from "@/lib/ai/conversation-analysis/view-service";

const activeStatuses = new Set(["PENDING", "RUNNING", "RETRY_SCHEDULED"]);
const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export const MAX_CONVERSATION_ANALYSIS_POLL_FAILURES = 3;

export type ConversationIntelligenceTone =
  | "neutral"
  | "progress"
  | "success"
  | "warning"
  | "error";

export type ConversationIntelligencePresentation = {
  kind:
    | "disabled"
    | "unavailable"
    | "not-analyzed"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "skipped"
    | "refreshing";
  heading: string;
  message: string;
  tone: ConversationIntelligenceTone;
  active: boolean;
  canAnalyze: boolean;
  buttonLabel: string | null;
};

export function isActiveConversationAnalysisStatus(
  status: string | null | undefined,
) {
  return Boolean(status && activeStatuses.has(status));
}

export function isTerminalConversationAnalysisStatus(
  status: string | null | undefined,
) {
  return Boolean(status && terminalStatuses.has(status));
}

export function nextConversationAnalysisPollingFailure(
  previousCount: number,
  responseStatus?: number,
) {
  const count = Math.min(
    Math.max(0, Math.trunc(previousCount)) + 1,
    MAX_CONVERSATION_ANALYSIS_POLL_FAILURES,
  );
  const authenticationRequired =
    responseStatus === 401 || responseStatus === 403;
  return {
    count,
    exhausted:
      authenticationRequired ||
      count >= MAX_CONVERSATION_ANALYSIS_POLL_FAILURES,
    authenticationRequired,
  };
}

export function conversationIntelligencePresentation({
  view,
  job,
}: {
  view: ConversationIntelligenceView;
  job: ConversationAnalysisJobView | null;
}): ConversationIntelligencePresentation {
  if (!view.enabled) {
    return {
      kind: "disabled",
      heading: "Conversation Intelligence is off",
      message:
        "Enable it in Settings to analyze eligible conversation text. Attachments are not included.",
      tone: "neutral",
      active: false,
      canAnalyze: false,
      buttonLabel: null,
    };
  }
  if (!view.configuration.available) {
    return {
      kind: "unavailable",
      heading: "Conversation analysis is unavailable",
      message: view.configuration.message,
      tone: "warning",
      active: false,
      canAnalyze: false,
      buttonLabel: null,
    };
  }

  if (job?.status === "PENDING" || job?.status === "RETRY_SCHEDULED") {
    return {
      kind: "queued",
      heading:
        job.status === "RETRY_SCHEDULED"
          ? "Analysis will retry"
          : "Analysis queued",
      message:
        job.status === "RETRY_SCHEDULED"
          ? "A temporary problem interrupted analysis. LeadHome will try again."
          : "The analysis will begin when a worker is available.",
      tone: job.status === "RETRY_SCHEDULED" ? "warning" : "progress",
      active: true,
      canAnalyze: false,
      buttonLabel: "Analysis queued",
    };
  }
  if (job?.status === "RUNNING") {
    return {
      kind: "running",
      heading: "Analyzing conversation",
      message: "LeadHome is preparing a factual summary and suggestions.",
      tone: "progress",
      active: true,
      canAnalyze: false,
      buttonLabel: "Analyzing…",
    };
  }
  if (
    job?.status === "COMPLETED" &&
    view.analysis?.status !== "COMPLETED" &&
    view.analysis?.status !== "SKIPPED"
  ) {
    return {
      kind: "refreshing",
      heading: "Analysis finished",
      message: "Refreshing the saved conversation intelligence.",
      tone: "progress",
      active: false,
      canAnalyze: false,
      buttonLabel: null,
    };
  }
  if (job?.status === "FAILED" || view.analysis?.status === "FAILED") {
    return {
      kind: "failed",
      heading: "Analysis could not be completed",
      message:
        "The last completed analysis remains below, when available. You can try again.",
      tone: "error",
      active: false,
      canAnalyze: true,
      buttonLabel: "Try analysis again",
    };
  }
  if (job?.status === "CANCELLED" || view.analysis?.status === "CANCELLED") {
    return {
      kind: "cancelled",
      heading: "Analysis was cancelled",
      message: "No conversation or Lead data was changed.",
      tone: "neutral",
      active: false,
      canAnalyze: true,
      buttonLabel: "Try analysis again",
    };
  }
  if (view.analysis?.status === "SKIPPED") {
    return {
      kind: "skipped",
      heading: "No analyzable message text",
      message:
        "This conversation does not currently contain enough message text to analyze.",
      tone: "neutral",
      active: false,
      canAnalyze: true,
      buttonLabel: "Try analysis again",
    };
  }
  if (
    view.analysis?.status === "COMPLETED" &&
    view.analysis.output &&
    !view.analysis.outputInvalid
  ) {
    return {
      kind: "completed",
      heading: "Analysis complete",
      message:
        "Detected details and suggestions are shown below. Lead fields were not changed.",
      tone: "success",
      active: false,
      canAnalyze: true,
      buttonLabel: "Reanalyze",
    };
  }
  if (
    view.analysis?.status === "COMPLETED" &&
    (!view.analysis.output || view.analysis.outputInvalid)
  ) {
    return {
      kind: "failed",
      heading: "Saved analysis is unavailable",
      message: "The saved result could not be displayed safely. Try analysis again.",
      tone: "error",
      active: false,
      canAnalyze: true,
      buttonLabel: "Try analysis again",
    };
  }

  return {
    kind: "not-analyzed",
    heading: "Not analyzed",
    message:
      "Create a concise summary and suggested next actions. Nothing is written to the Lead automatically.",
    tone: "neutral",
    active: false,
    canAnalyze: true,
    buttonLabel: "Analyze conversation",
  };
}
