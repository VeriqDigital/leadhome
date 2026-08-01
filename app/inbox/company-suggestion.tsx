"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  mutateConversationCompanyAction,
} from "@/app/actions/inbox-actions";
import {
  initialCompanyDetectionMutationState,
  type CompanyDetectionMutationState,
} from "./mutation-state";
import type {
  CompanySuggestionSource,
  ConversationCompanyView,
} from "@/lib/messaging/company-detection-service";

type CompanyIntent = "APPLY" | "DISMISS" | "RECHECK";

const sourceLabels: Record<CompanySuggestionSource, string> = {
  DOMAIN_ASSOCIATION: "Matched from a known company domain",
  STRUCTURED_ANALYSIS: "Detected from structured conversation details",
  BUSINESS_DOMAIN: "Detected from sender domain",
};

function ResultMessage({
  state,
  pending,
}: {
  state: CompanyDetectionMutationState;
  pending: boolean;
}) {
  if (!state.message || pending) return null;

  return (
    <p
      role={state.success ? "status" : "alert"}
      aria-live="polite"
      className={`mt-3 text-xs ${
        state.success
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-red-700 dark:text-red-300"
      }`}
    >
      {state.message}
    </p>
  );
}

export function CompanySuggestion({
  initialView,
}: {
  initialView: ConversationCompanyView | null;
}) {
  const view = initialView;
  const router = useRouter();
  const [state, action, pending] = useActionState(
    mutateConversationCompanyAction,
    initialCompanyDetectionMutationState,
  );
  const [submittedIntent, setSubmittedIntent] =
    useState<CompanyIntent | null>(null);

  useEffect(() => {
    if (state.companyView) router.refresh();
  }, [router, state.companyView]);

  if (
    !view?.lead ||
    view.lead.company?.trim() ||
    view.state === "NOT_APPLICABLE" ||
    view.state === "COMPANY_PRESENT"
  ) {
    return null;
  }

  const suggestion =
    view.state === "SUGGESTED" ? view.suggestion : null;
  const canRecheck = view.canRecheck;

  if (!suggestion && !canRecheck) return null;

  return (
    <section
      aria-labelledby={`company-detection-${view.conversationId}`}
      className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/25 dark:text-amber-100"
    >
      <form action={action} aria-busy={pending}>
        <input
          type="hidden"
          name="conversationId"
          value={view.conversationId}
        />
        <input type="hidden" name="expectedLeadId" value={view.lead.id} />
        {suggestion?.evidenceFingerprint && (
          <input
            type="hidden"
            name="evidenceFingerprint"
            value={suggestion.evidenceFingerprint}
          />
        )}

        {suggestion ? (
          <>
            <p
              id={`company-detection-${view.conversationId}`}
              className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-800 dark:text-amber-300"
            >
              Suggested company
            </p>
            <p className="mt-1 text-base font-semibold text-[#20242c] dark:text-[#f4f6fa]">
              {suggestion.value}
            </p>
            <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/85">
              {sourceLabels[suggestion.source]}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                name="intent"
                value="APPLY"
                aria-label={
                  pending && submittedIntent === "APPLY"
                    ? "Applying company"
                    : "Apply company"
                }
                disabled={pending}
                onClick={() => setSubmittedIntent("APPLY")}
                className="company-apply-button cursor-pointer rounded-lg border border-transparent bg-[#17181c] px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:cursor-wait disabled:opacity-60"
              >
                {pending && submittedIntent === "APPLY"
                  ? "Applying…"
                  : "Apply company"}
              </button>
              <button
                type="submit"
                name="intent"
                value="DISMISS"
                aria-label={
                  pending && submittedIntent === "DISMISS"
                    ? "Dismissing company suggestion"
                    : "Dismiss company suggestion"
                }
                disabled={pending}
                onClick={() => setSubmittedIntent("DISMISS")}
                className="cursor-pointer rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40"
              >
                {pending && submittedIntent === "DISMISS"
                  ? "Dismissing…"
                  : "Dismiss"}
              </button>
              {canRecheck && (
                <button
                  type="submit"
                  name="intent"
                  value="RECHECK"
                  aria-label={
                    pending && submittedIntent === "RECHECK"
                      ? "Checking company"
                      : "Recheck company"
                  }
                  disabled={pending}
                  onClick={() => setSubmittedIntent("RECHECK")}
                  className="cursor-pointer rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40"
                >
                  {pending && submittedIntent === "RECHECK"
                    ? "Checking…"
                    : "Recheck company"}
                </button>
              )}
            </div>

            {(suggestion.evidenceSummary.trim() ||
              suggestion.evidenceDetails.length > 0) && (
              <details
                aria-disabled={pending}
                className={`mt-3 text-xs text-amber-900/85 dark:text-amber-200/85 ${
                  pending ? "pointer-events-none opacity-60" : ""
                }`}
              >
                <summary className="cursor-pointer font-semibold underline underline-offset-2">
                  Inspect evidence
                </summary>
                <div className="mt-2 rounded-lg border border-amber-200/80 bg-white/60 p-3 dark:border-amber-800/80 dark:bg-black/15">
                  {suggestion.evidenceSummary.trim() && (
                    <p>{suggestion.evidenceSummary}</p>
                  )}
                  {suggestion.evidenceDetails.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {suggestion.evidenceDetails.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            )}
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3
                id={`company-detection-${view.conversationId}`}
                className="text-sm font-semibold text-[#20242c] dark:text-[#f4f6fa]"
              >
                Company not detected
              </h3>
              <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/85">
                Check again when this conversation has new company evidence.
              </p>
            </div>
            <button
              type="submit"
              name="intent"
              value="RECHECK"
              aria-label={
                pending && submittedIntent === "RECHECK"
                  ? "Checking company"
                  : "Recheck company"
              }
              disabled={pending}
              onClick={() => setSubmittedIntent("RECHECK")}
              className="cursor-pointer rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40"
            >
              {pending && submittedIntent === "RECHECK"
                ? "Checking…"
                : "Recheck company"}
            </button>
          </div>
        )}

        <ResultMessage state={state} pending={pending} />
      </form>
    </section>
  );
}
