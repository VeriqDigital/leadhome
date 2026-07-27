"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  analyzeConversationAction,
  type ConversationAnalysisActionState,
} from "@/app/actions/conversation-analysis-actions";
import type {
  ConversationIntelligenceAnalysisView,
  ConversationIntelligenceView,
} from "@/lib/ai/conversation-analysis/view-service";
import type { ConversationAnalysisJobView } from "@/lib/jobs/types";
import {
  conversationIntelligencePresentation,
  isActiveConversationAnalysisStatus,
  isTerminalConversationAnalysisStatus,
  nextConversationAnalysisPollingFailure,
  type ConversationIntelligenceTone,
} from "./conversation-intelligence-view";

const POLL_INTERVAL_MS = 5_000;
const initialActionState: ConversationAnalysisActionState = {
  success: false,
  message: "",
};
const dateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const toneClasses: Record<ConversationIntelligenceTone, string> = {
  neutral: "border-l-[#a7afbe] text-[#687080] dark:text-[#aeb3bd]",
  progress: "border-l-blue-500 text-blue-700 dark:text-blue-300",
  success:
    "border-l-emerald-500 text-emerald-700 dark:text-emerald-300",
  warning: "border-l-amber-500 text-amber-700 dark:text-amber-300",
  error: "border-l-red-500 text-red-700 dark:text-red-300",
};

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateTime.format(date);
}

function budgetText(
  budget: NonNullable<
    ConversationIntelligenceAnalysisView["output"]
  >["budget"],
) {
  if (budget.rawText) return budget.rawText;
  const amount = (value: number) =>
    new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
  const prefix = budget.currency ? `${budget.currency} ` : "";
  if (budget.minimumAmount !== null && budget.maximumAmount !== null) {
    return `${prefix}${amount(budget.minimumAmount)}–${amount(budget.maximumAmount)}`;
  }
  if (budget.minimumAmount !== null) {
    return `${prefix}${amount(budget.minimumAmount)} minimum`;
  }
  if (budget.maximumAmount !== null) {
    return `${prefix}${amount(budget.maximumAmount)} maximum`;
  }
  return null;
}

function Detail({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return <div>
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#777e89]">
      {term}
    </dt>
    <dd className="mt-1 text-sm text-[#20242c] dark:text-[#ececef]">
      {children}
    </dd>
  </div>;
}

function AnalysisResult({
  analysis,
  isCurrent,
}: {
  analysis: ConversationIntelligenceAnalysisView;
  isCurrent: boolean;
}) {
  const output = analysis.output;
  if (!output) return null;

  const contact = [
    output.contact.name,
    output.contact.email,
    output.contact.phone,
  ].filter((value): value is string => Boolean(value));
  const budget = budgetText(output.budget);
  const timeline = [output.timeline.rawText, output.timeline.targetDate]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const sentiment =
    output.sentiment.value === "UNKNOWN"
      ? null
      : output.sentiment.value.toLowerCase().replace(/^\w/, (letter) =>
          letter.toUpperCase(),
        );
  const analyzedAt = formatDate(analysis.completedAt);

  return <div className="mt-4 border-t border-black/[0.08] pt-4 dark:border-white/10">
    {!isCurrent && (
      <p className="mb-3 text-xs font-semibold text-[#687080] dark:text-[#aeb3bd]">
        Last completed analysis
      </p>
    )}
    <p className="text-sm leading-6 text-[#20242c] dark:text-[#ececef]">
      {output.summary}
    </p>
    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
      {output.company.value && (
        <Detail term="Detected company">{output.company.value}</Detail>
      )}
      {contact.length > 0 && (
        <Detail term="Suggested contact">
          <span className="break-words">{contact.join(" · ")}</span>
        </Detail>
      )}
      {output.projectType.value && (
        <Detail term="Detected project type">
          {output.projectType.value}
        </Detail>
      )}
      {budget && <Detail term="Explicit budget">{budget}</Detail>}
      {timeline && <Detail term="Detected timeline">{timeline}</Detail>}
      {sentiment && <Detail term="Detected sentiment">{sentiment}</Detail>}
    </dl>

    {output.actionItems.length > 0 && (
      <section className="mt-5" aria-labelledby={`analysis-actions-${analysis.id}`}>
        <h4
          id={`analysis-actions-${analysis.id}`}
          className="text-xs font-semibold"
        >
          Suggested actions
        </h4>
        <ul className="mt-2 space-y-2">
          {output.actionItems.map((item, index) => (
            <li
              key={`${item.title}:${index}`}
              className="rounded-lg bg-black/[0.025] p-3 dark:bg-white/[0.04]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{item.title}</p>
                  {item.description && (
                    <p className="mt-1 text-xs leading-5 text-[#687080] dark:text-[#aeb3bd]">
                      {item.description}
                    </p>
                  )}
                  {item.dueDate && (
                    <p className="mt-1 text-[11px] text-[#777e89]">
                      Suggested due date: {item.dueDate}
                    </p>
                  )}
                </div>
                <Link
                  href={`/tasks/new?analysis=${encodeURIComponent(analysis.id)}&item=${index}`}
                  className="shrink-0 text-xs font-semibold underline"
                >
                  Create task
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>
    )}

    {output.missingInformation.length > 0 && (
      <section className="mt-5">
        <h4 className="text-xs font-semibold">Not mentioned</h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[#687080] dark:text-[#aeb3bd]">
          {output.missingInformation.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    )}

    {analysis.inputTruncated && (
      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        Some message text was omitted to keep this analysis within the
        configured input limit.
      </p>
    )}
    {analyzedAt && (
      <p className="mt-3 text-[11px] text-[#777e89]">
        Analyzed <time dateTime={analysis.completedAt ?? undefined}>{analyzedAt}</time>
      </p>
    )}
  </div>;
}

export function ConversationIntelligenceCard({
  conversationId,
  initialView,
}: {
  conversationId: string;
  initialView: ConversationIntelligenceView;
}) {
  const router = useRouter();
  const [job, setJob] = useState<ConversationAnalysisJobView | null>(
    initialView.job,
  );
  const [pollingError, setPollingError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const consecutivePollFailures = useRef(0);
  const refreshedJobs = useRef(new Set<string>());

  const submitAction = useCallback(
    async (
      previous: ConversationAnalysisActionState,
      formData: FormData,
    ) => {
      const result = await analyzeConversationAction(previous, formData);
      consecutivePollFailures.current = 0;
      setPollingError(null);
      if (result.job) setJob(result.job);
      else if (result.success) router.refresh();
      return result;
    },
    [router],
  );
  const [actionState, formAction, pending] = useActionState(
    submitAction,
    initialActionState,
  );
  const presentation = conversationIntelligencePresentation({
    view: initialView,
    job,
  });
  const jobId = job?.id;
  const jobStatus = job?.status;

  useEffect(() => {
    if (!jobId || !isActiveConversationAnalysisStatus(jobStatus)) return;

    const controller = new AbortController();
    let disposed = false;

    const stopWithFailure = (responseStatus?: number) => {
      const failure = nextConversationAnalysisPollingFailure(
        consecutivePollFailures.current,
        responseStatus,
      );
      consecutivePollFailures.current = failure.count;
      if (!failure.exhausted || disposed) return;
      window.clearInterval(timer);
      setPollingError(
        failure.authenticationRequired
          ? "Your session has ended. Refresh the page or sign in again."
          : "Analysis status is temporarily unavailable. Refresh the page to check again.",
      );
    };

    const poll = async () => {
      if (disposed || inFlight.current) return;
      inFlight.current = true;
      try {
        const response = await fetch(
          `/api/jobs/conversation-analysis/status?jobId=${encodeURIComponent(jobId)}`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          stopWithFailure(response.status);
          return;
        }
        const body = await response.json() as {
          job: ConversationAnalysisJobView | null;
        };
        if (disposed) return;
        consecutivePollFailures.current = 0;
        setPollingError(null);
        setJob(body.job);
        if (
          (!body.job ||
            isTerminalConversationAnalysisStatus(body.job.status)) &&
          !refreshedJobs.current.has(jobId)
        ) {
          refreshedJobs.current.add(jobId);
          window.clearInterval(timer);
          router.refresh();
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          stopWithFailure();
        }
      } finally {
        inFlight.current = false;
      }
    };

    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      inFlight.current = false;
    };
  }, [jobId, jobStatus, router]);

  const actionError =
    !actionState.success && actionState.message
      ? actionState.message
      : null;
  const displayedError = actionError ?? pollingError;
  const statusHeading = displayedError
    ? "Conversation analysis is unavailable"
    : presentation.heading;
  const statusMessage = displayedError ?? presentation.message;
  const displayedTone = displayedError ? "error" : presentation.tone;
  const canSubmit = !pending && presentation.canAnalyze;
  const completedOutput = Boolean(
    initialView.analysis?.output &&
      initialView.analysis.completedAt &&
      !initialView.analysis.outputInvalid,
  );

  return <section
    aria-labelledby={`conversation-intelligence-${conversationId}`}
    className="mt-5 rounded-xl border border-black/[0.08] p-4 dark:border-white/10 dark:bg-white/[0.02]"
  >
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3
          id={`conversation-intelligence-${conversationId}`}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <Sparkles aria-hidden="true" className="size-4 text-[#7770c8]" />
          Conversation intelligence
        </h3>
        <p className="mt-1 text-xs text-[#687080] dark:text-[#aeb3bd]">
          AI-detected details are suggestions and never update the Lead automatically.
        </p>
      </div>
      {presentation.canAnalyze && (
        <form action={formAction}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <button
            type="submit"
            disabled={!canSubmit}
            className="cursor-pointer rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/[0.05]"
          >
            {pending
              ? "Queuing analysis…"
              : presentation.buttonLabel}
          </button>
        </form>
      )}
    </div>

    <div
      role={displayedError ? "alert" : "status"}
      aria-live={displayedError ? "assertive" : "polite"}
      className={`mt-3 border-l-4 pl-3 ${toneClasses[displayedTone]}`}
    >
      <p className="text-xs font-semibold">{statusHeading}</p>
      <p className="mt-1 text-xs leading-5 text-[#687080] dark:text-[#aeb3bd]">
        {statusMessage}
      </p>
    </div>

    {(presentation.kind === "disabled" ||
      presentation.kind === "unavailable") && (
      <Link href="/settings" className="mt-3 inline-block text-xs font-semibold underline">
        Open Settings
      </Link>
    )}

    {initialView.analysis && completedOutput && (
      <AnalysisResult
        analysis={initialView.analysis}
        isCurrent={presentation.kind === "completed"}
      />
    )}
  </section>;
}
