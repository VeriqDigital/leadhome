"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GmailConnectLink } from "@/app/gmail-connect-link";
import {
  syncGmailAction,
  type GmailSyncActionState,
} from "@/app/actions/gmail-actions";
import type { GmailSyncJobView } from "@/lib/jobs/types";
import {
  gmailSyncPresentation,
  isActiveGmailSyncStatus,
  isTerminalGmailSyncStatus,
  nextGmailSyncPollingFailure,
  type LegacyImportSummary,
  type SyncTone,
} from "./gmail-sync-view";

const POLL_INTERVAL_MS = 5_000;
const dateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const initialActionState: GmailSyncActionState = {
  success: false,
  message: "",
};

const toneAccentClasses: Record<SyncTone, string> = {
  neutral: "text-[#687080] dark:text-[#a7afbe]",
  progress: "text-blue-700 dark:text-blue-300",
  success: "text-emerald-700 dark:text-emerald-300",
  noChanges: "text-sky-700 dark:text-sky-300",
  warning: "text-amber-700 dark:text-amber-300",
  error: "text-red-700 dark:text-red-300",
};

const toneBorderClasses: Record<SyncTone, string> = {
  neutral: "border-l-[#a7afbe]",
  progress: "border-l-blue-500",
  success: "border-l-emerald-500",
  noChanges: "border-l-sky-500",
  warning: "border-l-amber-500",
  error: "border-l-red-500",
};

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateTime.format(date);
}

function formatDuration(value: number | null) {
  if (value === null) return "Unavailable";
  if (value < 1_000) return "Less than a second";
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function GmailSyncForm({
  accountId,
  initialJob = null,
  lastSuccessfulSyncAt = null,
  fallbackSummary = null,
  fallbackError = null,
  variant = "inbox",
}: {
  accountId: string;
  initialJob?: GmailSyncJobView | null;
  lastSuccessfulSyncAt?: string | null;
  fallbackSummary?: LegacyImportSummary | null;
  fallbackError?: string | null;
  variant?: "inbox" | "settings";
}) {
  const router = useRouter();
  const [job, setJob] = useState<GmailSyncJobView | null>(initialJob);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const refreshedJobs = useRef(new Set<string>());
  const inFlight = useRef(false);
  const consecutivePollFailures = useRef(0);

  const submitAction = useCallback(
    async (previous: GmailSyncActionState, formData: FormData) => {
      const result = await syncGmailAction(previous, formData);
      if (result.job) {
        consecutivePollFailures.current = 0;
        setPollingError(null);
        setJob(result.job);
      }
      return result;
    },
    [],
  );
  const [actionState, formAction, pending] = useActionState(
    submitAction,
    initialActionState,
  );
  const presentation = gmailSyncPresentation({
    job,
    fallbackSummary,
    fallbackError,
  });
  const jobId = job?.id;
  const jobStatus = job?.status;

  useEffect(() => {
    if (!jobId || !isActiveGmailSyncStatus(jobStatus)) return;

    const controller = new AbortController();
    let disposed = false;

    const recordFailure = (responseStatus?: number) => {
      const failure = nextGmailSyncPollingFailure(
        consecutivePollFailures.current,
        responseStatus,
      );
      consecutivePollFailures.current = failure.count;
      if (!failure.exhausted || disposed) return;
      window.clearInterval(timer);
      setPollingError(
        failure.authenticationRequired
          ? "Your session has ended. Refresh the page or sign in again."
          : "We cannot confirm whether the Gmail check finished. Refresh the page to check again.",
      );
    };

    const poll = async () => {
      if (disposed || inFlight.current) return;
      inFlight.current = true;
      try {
        const response = await fetch(
          `/api/jobs/status?accountId=${encodeURIComponent(accountId)}`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          recordFailure(response.status);
          return;
        }
        const body = await response.json() as { job: GmailSyncJobView | null };
        if (disposed) return;
        consecutivePollFailures.current = 0;
        setPollingError(null);
        setJob(body.job);

        if (
          (!body.job || isTerminalGmailSyncStatus(body.job.status)) &&
          !refreshedJobs.current.has(jobId)
        ) {
          refreshedJobs.current.add(jobId);
          window.clearInterval(timer);
          router.refresh();
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          recordFailure();
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
  }, [accountId, jobId, jobStatus, router]);

  const queuedAt = formatDate(job?.queuedAt);
  const startedAt = formatDate(job?.startedAt);
  const completedAt = formatDate(job?.completedAt);
  const failedAt = formatDate(job?.failedAt);
  const retryAt = job?.status === "RETRY_SCHEDULED"
    ? formatDate(job.availableAt)
    : null;
  const lastSuccess = formatDate(lastSuccessfulSyncAt);
  const actionError = !actionState.success && actionState.message
    ? actionState.message
    : null;
  const displayedError = actionError ?? pollingError;
  const displayedMessage = actionError
    ? "We could not start the Gmail check. Please try again."
    : pollingError ?? presentation.message;
  const liveError = Boolean(displayedError || presentation.tone === "error");
  const displayedTone: SyncTone = displayedError ? "error" : presentation.tone;
  const disabled = pending || presentation.active || !presentation.canSubmit;

  return <div className={variant === "inbox" ? "text-right" : ""}>
    {presentation.reconnectRequired
      ? <GmailConnectLink
          reconnect
          className={`${variant === "inbox"
            ? "rounded-xl border border-amber-300 px-4 py-2.5 text-amber-800 dark:text-amber-300"
            : "rounded-lg border border-amber-300 px-3 py-2 text-amber-800 dark:text-amber-300"
          } inline-flex text-sm font-semibold`}
        >
          Reconnect Gmail
        </GmailConnectLink>
      : <form action={formAction}>
          <input type="hidden" name="accountId" value={accountId}/>
          <button
            type="submit"
            disabled={disabled}
            className={`${variant === "inbox"
              ? "rounded-xl bg-[#17181c] px-4 py-2.5 text-white dark:border dark:border-white/10"
              : "rounded-lg border border-black/10 px-3 py-2 dark:border-white/10"
            } cursor-pointer text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {pending
              ? "Check queued"
              : presentation.buttonLabel}
          </button>
        </form>}

    <div
      className={`mt-2 rounded-xl border border-l-4 border-black/10 bg-black/[0.025] px-3 py-2.5 text-[#20242c] dark:border-white/10 dark:bg-white/[0.04] dark:text-[#eef1f7] ${toneBorderClasses[displayedTone]} ${variant === "inbox" ? "ml-auto max-w-md text-left" : ""} text-xs`}
    >
      <div
        aria-live={liveError ? "assertive" : "polite"}
        role={liveError ? "alert" : "status"}
        className="flex items-start gap-2"
      >
        <span
          aria-hidden="true"
          className={`mt-1 size-2 shrink-0 rounded-full bg-current ${toneAccentClasses[displayedTone]}`}
        />
        <div>
          <p className={`font-semibold ${toneAccentClasses[displayedTone]}`}>
            {actionError
              ? "We could not start the Gmail check"
              : pollingError
                ? "Gmail status is unavailable"
                : presentation.heading}
          </p>
          <p className="mt-1 text-[#687080] dark:text-[#a7afbe]">
            {displayedMessage}
          </p>
        </div>
      </div>
      {variant === "inbox" && presentation.summary && (
        <div className="mt-3 space-y-3 border-t border-black/10 pt-3 dark:border-white/10">
          {(presentation.summary.runActivity.newConversations > 0 ||
            presentation.summary.runActivity.newMessages > 0) && (
            <section aria-labelledby={`gmail-added-${job?.id ?? "latest"}`}>
              <p
                id={`gmail-added-${job?.id ?? "latest"}`}
                className="font-semibold"
              >
                Added this check
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <dd className="text-base font-semibold">
                    {presentation.summary.runActivity.newConversations}
                  </dd>
                  <dt className="text-[#687080] dark:text-[#a7afbe]">
                    New conversations
                  </dt>
                </div>
                <div>
                  <dd className="text-base font-semibold">
                    {presentation.summary.runActivity.newMessages}
                  </dd>
                  <dt className="text-[#687080] dark:text-[#a7afbe]">
                    New individual emails
                  </dt>
                </div>
              </dl>
              <p className="mt-2 text-[#687080] dark:text-[#a7afbe]">
                A conversation is an email thread and may contain multiple
                individual emails.
              </p>
            </section>
          )}

          {(presentation.summary.reviewState.processedConversationsLinked > 0 ||
            presentation.summary.reviewState.processedConversationsNeedingReview > 0) && (
            <section aria-labelledby={`gmail-review-${job?.id ?? "latest"}`}>
              <p
                id={`gmail-review-${job?.id ?? "latest"}`}
                className="font-semibold"
              >
                Among conversations checked
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <dd className="text-base font-semibold">
                    {presentation.summary.reviewState.processedConversationsLinked}
                  </dd>
                  <dt className="text-[#687080] dark:text-[#a7afbe]">
                    Matched to a lead
                  </dt>
                </div>
                <div>
                  <dd className="text-base font-semibold">
                    {presentation.summary.reviewState.processedConversationsNeedingReview}
                  </dd>
                  <dt className="text-[#687080] dark:text-[#a7afbe]">
                    Need review
                  </dt>
                </div>
              </dl>
              <p className="mt-2 text-[#687080] dark:text-[#a7afbe]">
                These counts cover this check only. Matches can include
                conversations that were already linked to the same lead.
              </p>
            </section>
          )}

          <details className="group border-t border-black/10 pt-2 dark:border-white/10">
            <summary className="cursor-pointer font-semibold text-[#4f596b] marker:text-[#687080] hover:text-[#20242c] focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-[#bdc5d3] dark:hover:text-white">
              View details
            </summary>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[#687080] dark:text-[#a7afbe]">
              <div>
                <dt>Accounts checked</dt>
                <dd className="font-semibold text-[#20242c] dark:text-[#eef1f7]">
                  {presentation.summary.execution.accountsChecked}
                </dd>
              </div>
              <div>
                <dt>Conversations checked</dt>
                <dd className="font-semibold text-[#20242c] dark:text-[#eef1f7]">
                  {presentation.summary.execution.conversationsChecked}
                </dd>
              </div>
              <div>
                <dt>Existing conversations checked</dt>
                <dd className="font-semibold text-[#20242c] dark:text-[#eef1f7]">
                  {presentation.summary.runActivity.updatedConversations}
                </dd>
              </div>
              <div>
                <dt>Emails already imported</dt>
                <dd className="font-semibold text-[#20242c] dark:text-[#eef1f7]">
                  {presentation.summary.runActivity.skippedMessages}
                </dd>
              </div>
              <div>
                <dt>Import issues</dt>
                <dd className="font-semibold text-[#20242c] dark:text-[#eef1f7]">
                  {presentation.summary.execution.errorCount}
                </dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd className="font-semibold text-[#20242c] dark:text-[#eef1f7]">
                  {formatDuration(presentation.summary.execution.durationMs)}
                </dd>
              </div>
            </dl>
          </details>
        </div>
      )}
      {variant === "settings" &&
        presentation.summary &&
        presentation.summary.reviewState.processedConversationsNeedingReview > 0 && (
          <p className="mt-2 font-medium text-amber-700 dark:text-amber-300">
            {presentation.summary.reviewState.processedConversationsNeedingReview}
            {" "}checked conversation{presentation.summary.reviewState.processedConversationsNeedingReview === 1 ? "" : "s"} need review.
          </p>
        )}
      {presentation.active && presentation.percent !== null && (
        <div className="mt-2">
          <div
            role="progressbar"
            aria-label="Gmail check progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={presentation.percent}
            className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
          >
            <div
              className="h-full rounded-full bg-current transition-[width]"
              style={{ width: `${presentation.percent}%` }}
            />
          </div>
          <span className="mt-1 block">{presentation.percent}% complete</span>
        </div>
      )}
      {presentation.active && job?.progress && presentation.percent === null && (
        <p className="mt-1">
          Checked {job.progress.processed}
          {typeof job.progress.total === "number" ? ` of ${job.progress.total}` : ""}
          {" "}conversations
        </p>
      )}
      {presentation.active && queuedAt && !startedAt && (
        <p className="mt-1 opacity-70">Requested {queuedAt}</p>
      )}
      {presentation.active && startedAt && (
        <p className="mt-1 opacity-70">Started {startedAt}</p>
      )}
      {retryAt && (
        <p className="mt-1 opacity-70">We will try again {retryAt}</p>
      )}
      {completedAt && job?.status === "COMPLETED" && (
        <p className="mt-1 opacity-70">Checked {completedAt}</p>
      )}
      {failedAt && job?.status === "FAILED" && (
        <p className="mt-1 opacity-70">Last attempt {failedAt}</p>
      )}
      {lastSuccess && job?.status !== "COMPLETED" && (
        <p className="mt-1 opacity-70">Last successful check: {lastSuccess}</p>
      )}
    </div>
  </div>;
}
