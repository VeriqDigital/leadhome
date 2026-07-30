"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  attachInboxAction,
  dismissConversationMatchAction,
  recheckConversationMatchesAction,
  type SmartMatchMutationState,
} from "@/app/actions/inbox-actions";
import {
  initialInboxMutationState,
} from "./mutation-state";
import type {
  LeadMatchCandidate,
  LeadMatchResult,
} from "@/lib/messaging/matching-service";

const initialSmartMatchState: SmartMatchMutationState = {
  success: false,
  message: "",
};

const confidenceLabels = {
  HIGH: "Strong evidence",
  MEDIUM: "Possible match",
  LOW: "Name match",
} as const;

function Candidate({
  candidate,
  conversationId,
  attaching,
  dismissing,
  attachAction,
  dismissAction,
}: {
  candidate: LeadMatchCandidate;
  conversationId: string;
  attaching: boolean;
  dismissing: boolean;
  attachAction: (payload: FormData) => void;
  dismissAction: (payload: FormData) => void;
}) {
  return (
    <li className="rounded-xl border border-amber-200 bg-white/70 p-3 dark:border-amber-800/70 dark:bg-black/15">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#20242c] dark:text-[#f4f6fa]">
            {candidate.name}
          </p>
          {candidate.company && (
            <p className="mt-0.5 text-xs text-[#596171] dark:text-[#b4bdcc]">
              {candidate.company}
            </p>
          )}
          {candidate.email && (
            <p className="mt-0.5 text-xs text-[#596171] dark:text-[#b4bdcc]">
              {candidate.email}
            </p>
          )}
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
          {confidenceLabels[candidate.confidence]}
        </span>
      </div>
      <ul
        aria-label={`Why ${candidate.name} was suggested`}
        className="mt-2 space-y-1 text-xs text-[#596171] dark:text-[#b4bdcc]"
      >
        {candidate.reasons.map((reason) => (
          <li key={reason}>• {reason}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={attachAction}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="leadId" value={candidate.leadId} />
          <button
            disabled={attaching || dismissing}
            className="cursor-pointer rounded-lg bg-[#17181c] px-3 py-2 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60 dark:border dark:border-white/10"
          >
            {attaching ? "Attaching…" : "Attach to lead"}
          </button>
        </form>
        <Link
          href={`/leads/${candidate.leadId}`}
          className="rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold dark:border-white/15"
        >
          Inspect lead
        </Link>
        <form action={dismissAction}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="leadId" value={candidate.leadId} />
          <button
            disabled={attaching || dismissing}
            className="cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold text-[#596171] underline-offset-2 hover:underline disabled:cursor-wait disabled:opacity-60 dark:text-[#b4bdcc]"
          >
            {dismissing ? "Dismissing…" : "Dismiss suggestion"}
          </button>
        </form>
      </div>
    </li>
  );
}

export function LeadMatchSuggestions({
  conversationId,
  match,
  canRecheck,
}: {
  conversationId: string;
  match: LeadMatchResult | null;
  canRecheck: boolean;
}) {
  const router = useRouter();
  const [attachState, attachAction, attaching] = useActionState(
    attachInboxAction,
    initialInboxMutationState,
  );
  const [dismissState, dismissAction, dismissing] = useActionState(
    dismissConversationMatchAction,
    initialSmartMatchState,
  );
  const [recheckState, recheckAction, rechecking] = useActionState(
    recheckConversationMatchesAction,
    initialSmartMatchState,
  );

  useEffect(() => {
    if (
      (attachState.success && attachState.changed) ||
      dismissState.success ||
      recheckState.success
    ) {
      router.refresh();
    }
  }, [attachState, dismissState, recheckState, router]);

  const candidates = match?.kind === "MATCHED"
    ? [match.automaticMatch]
    : match?.kind === "AMBIGUOUS"
      ? match.possibleMatches
      : [];
  const result = !attachState.success && attachState.message
    ? attachState
    : dismissState.message
      ? dismissState
      : recheckState.message
        ? recheckState
        : null;

  if (!candidates.length) {
    if (!canRecheck) return null;
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-black/[0.08] px-3 py-2.5 text-xs dark:border-white/10">
        <p className="text-[#687080] dark:text-[#a7afbe]">
          Check this conversation against your current leads.
        </p>
        <form action={recheckAction}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <button
            disabled={rechecking}
            className="cursor-pointer rounded-lg border border-black/10 px-3 py-2 font-semibold disabled:cursor-wait disabled:opacity-60 dark:border-white/15"
          >
            {rechecking ? "Checking…" : "Recheck matches"}
          </button>
        </form>
        {result && (
          <p
            role={result.success ? "status" : "alert"}
            aria-live="polite"
            className={result.success
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-red-700 dark:text-red-300"}
          >
            {result.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <section
      aria-labelledby={`possible-match-${conversationId}`}
      className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-800/70 dark:bg-amber-950/20"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id={`possible-match-${conversationId}`}
            className="font-semibold text-amber-950 dark:text-amber-100"
          >
            {match?.kind === "MATCHED" ? "Exact match found" : "Possible match"}
          </h3>
          <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
            {match?.kind === "MATCHED"
              ? "This lead has uniquely identifying evidence."
              : "Review these suggestions before attaching a lead."}
          </p>
        </div>
        {canRecheck && (
          <form action={recheckAction}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <button
              disabled={rechecking || attaching || dismissing}
              className="cursor-pointer rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-950 disabled:cursor-wait disabled:opacity-60 dark:border-amber-700 dark:text-amber-100"
            >
              {rechecking ? "Checking…" : "Recheck"}
            </button>
          </form>
        )}
      </div>
      <ol className="mt-3 space-y-2">
        {candidates.map((candidate) => (
          <Candidate
            key={candidate.leadId}
            candidate={candidate}
            conversationId={conversationId}
            attaching={attaching}
            dismissing={dismissing}
            attachAction={attachAction}
            dismissAction={dismissAction}
          />
        ))}
      </ol>
      <a
        href="#attached-lead-control"
        className="mt-3 inline-block text-xs font-semibold text-amber-950 underline dark:text-amber-100"
      >
        Choose another lead
      </a>
      {result && (
        <p
          role={result.success ? "status" : "alert"}
          aria-live="polite"
          className={`mt-3 text-xs ${
            result.success
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-red-700 dark:text-red-300"
          }`}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
