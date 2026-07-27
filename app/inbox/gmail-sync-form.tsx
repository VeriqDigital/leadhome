"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

const toneClasses: Record<SyncTone, string> = {
  neutral:
    "border-black/10 bg-black/[0.025] text-[#687080] dark:border-white/10 dark:bg-white/[0.04]",
  progress:
    "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-400/25 dark:bg-blue-400/10 dark:text-blue-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200",
  noChanges:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200",
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200",
};

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateTime.format(date);
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
      ? <Link
          href="/api/gmail/connect?reconnect=1"
          className={`${variant === "inbox"
            ? "rounded-xl border border-amber-300 px-4 py-2.5 text-amber-800 dark:text-amber-300"
            : "rounded-lg border border-amber-300 px-3 py-2 text-amber-800 dark:text-amber-300"
          } inline-flex text-sm font-semibold`}
        >
          Reconnect Gmail
        </Link>
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
              ? "Starting…"
              : pollingError
                ? "Check status"
                : presentation.buttonLabel}
          </button>
        </form>}

    <div
      aria-live={liveError ? "assertive" : "polite"}
      role={liveError ? "alert" : "status"}
      className={`mt-2 rounded-xl border px-3 py-2.5 ${variant === "inbox" ? "ml-auto max-w-md text-left" : ""} text-xs ${toneClasses[displayedTone]}`}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1 size-2 shrink-0 rounded-full bg-current"
        />
        <div>
          <p className="font-semibold">
            {actionError
              ? "We could not start the Gmail check"
              : pollingError
                ? "Gmail status is unavailable"
                : presentation.heading}
          </p>
          <p className="mt-1 opacity-80">
            {displayedMessage}
          </p>
        </div>
      </div>
      {presentation.summary.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-left">
          {presentation.summary.map((metric) => (
            <div key={metric.label}>
              <dt className="opacity-70">{metric.label}</dt>
              <dd className="font-semibold text-current">{metric.value}</dd>
            </div>
          ))}
        </dl>
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
