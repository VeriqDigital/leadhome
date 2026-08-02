"use client";

import { useActionState, useState } from "react";
import { mutateConversationContactAction } from "@/app/actions/inbox-actions";
import {
  initialContactExtractionMutationState,
  type ContactExtractionMutationState,
} from "./mutation-state";
import type {
  ContactField,
  ConversationContactExtractionView,
  ConversationContactSuggestion,
} from "@/lib/messaging/contact-extraction-service";

const fieldLabels: Record<ContactField, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
};

const secondaryButton =
  "cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60 dark:border-slate-600 dark:bg-[#17181c] dark:text-white dark:hover:bg-slate-800";

function contactViewRevision(
  view: ConversationContactExtractionView | null | undefined,
) {
  if (!view) return null;
  return JSON.stringify({
    conversationId: view.conversationId,
    state: view.state,
    lead: view.lead,
    suggestions: view.suggestions.map((suggestion) =>
      suggestion.reviewFingerprint),
    ambiguous: view.ambiguous,
    ambiguousFields: view.ambiguousFields,
    refreshing: view.refreshing,
    evaluatedAt: view.evaluatedAt,
  });
}

function ResultMessage({
  state,
  pending,
  lead,
}: {
  state: ContactExtractionMutationState;
  pending: boolean;
  lead?: ConversationContactExtractionView["lead"];
}) {
  if ((!state.message && !state.appliedFields?.length) || pending) return null;

  const appliedFields = state.appliedFields ?? [];

  return (
    <div className="mt-3 min-w-0">
      {state.message && (
        <p
          role={state.success ? "status" : "alert"}
          aria-live="polite"
          className={`text-xs ${
            state.success
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-red-700 dark:text-red-300"
          }`}
        >
          {state.message}
        </p>
      )}
      {lead && appliedFields.length > 0 && (
        <div className="mt-2 min-w-0 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-slate-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-slate-100">
          <p className="font-semibold">Updated lead contact</p>
          <dl className="mt-2 grid min-w-0 gap-2 sm:grid-cols-3">
            {appliedFields.map((field) => (
              <div key={field} className="min-w-0">
                <dt className="font-semibold text-slate-600 dark:text-slate-300">
                  {fieldLabels[field]}
                </dt>
                <dd className="mt-0.5 [overflow-wrap:anywhere]">
                  {lead[field]?.trim() || "Not set"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function HiddenSuggestionFields({
  conversationId,
  leadId,
  suggestion,
}: {
  conversationId: string;
  leadId: string;
  suggestion: ConversationContactSuggestion;
}) {
  return (
    <>
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="expectedLeadId" value={leadId} />
      <input type="hidden" name="field" value={suggestion.field} />
      <input
        type="hidden"
        name="evidenceFingerprint"
        value={suggestion.evidenceFingerprint}
      />
      <input
        type="hidden"
        name="reviewFingerprint"
        value={suggestion.reviewFingerprint}
      />
    </>
  );
}

export function ContactSuggestions({
  initialView,
}: {
  initialView: ConversationContactExtractionView | null;
}) {
  const [state, action, pending] = useActionState(
    mutateConversationContactAction,
    initialContactExtractionMutationState,
  );
  const [submittedCommand, setSubmittedCommand] = useState<string | null>(null);
  // The server action revalidates /inbox before returning. Prefer that fresh
  // server-rendered prop so a prior action result cannot mask later Gmail,
  // manual-edit, or reanalysis updates for the same selected conversation.
  const view = initialView ?? state.contactView;
  const feedbackState =
    !state.contactView ||
    !initialView ||
    contactViewRevision(state.contactView) === contactViewRevision(initialView)
      ? state
      : initialContactExtractionMutationState;

  const lead = view?.lead;
  if (!view || !lead) {
    return (
      <ResultMessage state={feedbackState} pending={pending} lead={lead} />
    );
  }

  const suggestions = view.suggestions;
  const isAmbiguous = view.ambiguousFields.length > 0 || view.ambiguous;
  if (suggestions.length === 0 && !isAmbiguous && !view.refreshing) {
    return (
      <ResultMessage state={feedbackState} pending={pending} lead={lead} />
    );
  }

  const safeSuggestions = suggestions.filter((suggestion) => !suggestion.conflict);
  const showApplyAvailable =
    suggestions.length >= 2 && safeSuggestions.length > 0;
  const showDismissAll = suggestions.length > 1;
  const headingId = `contact-suggestions-${view.conversationId}`;
  const primaryButton =
    "action-primary cursor-pointer rounded-lg border border-transparent px-3 py-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-60";
  const commandPending = (command: string) =>
    pending && submittedCommand === command;
  const hasPhoneSuggestion = suggestions.some(
    (suggestion) => suggestion.field === "phone",
  );
  const heading = view.refreshing
    ? "Contact details are refreshing"
    : isAmbiguous && hasPhoneSuggestion
      ? "Phone number available to review"
      : isAmbiguous
        ? "Conflicting contact identity detected"
        : "Contact details found";
  const description = view.refreshing
    ? "Contact details will refresh after analysis completes."
    : isAmbiguous && suggestions.length > 0
      ? "Conflicting contact identity detected. Confirm the contact manually. Unambiguous fields remain available to review."
      : isAmbiguous
        ? "Conflicting contact identity detected. Confirm the contact manually."
      : "Review each suggestion before changing the attached lead.";

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={pending}
      className="mt-4 min-w-0 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-slate-950 dark:border-indigo-800/70 dark:bg-indigo-950/20 dark:text-slate-100"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-indigo-700 dark:text-indigo-300">
          Reviewed contact extraction
        </p>
        <h3 id={headingId} className="mt-1 text-sm font-semibold">
          {heading}
        </h3>
        <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
          {description}
        </p>
      </div>

      {suggestions.length > 0 && (
        <ul className="mt-4 space-y-3">
          {suggestions.map((suggestion) => {
            const command = `${suggestion.conflict ? "REPLACE" : "APPLY"}:${suggestion.field}`;
            const dismissCommand = `DISMISS:${suggestion.field}`;
            const fieldLabel = fieldLabels[suggestion.field];
            const applyLabel = suggestion.conflict
              ? `Replace current ${fieldLabel.toLowerCase()}`
              : `Apply suggested ${fieldLabel.toLowerCase()}`;

            return (
              <li
                key={`${suggestion.field}:${suggestion.evidenceFingerprint}`}
                className="min-w-0 rounded-lg border border-indigo-200/80 bg-white/75 p-3 dark:border-indigo-800/70 dark:bg-[#17181c]"
              >
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">
                      {fieldLabel}
                    </p>
                    <dl className="mt-2 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="font-semibold text-slate-600 dark:text-slate-400">
                          Current
                        </dt>
                        <dd className="mt-0.5 [overflow-wrap:anywhere]">
                          {suggestion.currentValue?.trim() || "Not set"}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="font-semibold text-slate-600 dark:text-slate-400">
                          Suggested
                        </dt>
                        <dd className="mt-0.5 font-semibold [overflow-wrap:anywhere]">
                          {suggestion.candidateValue}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                      {suggestion.explanation}
                    </p>
                    {suggestion.conflict && (
                      <p className="mt-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                        Conflict — applying this suggestion replaces the current value.
                      </p>
                    )}
                  </div>

                  {view.refreshing ? (
                    <p className="shrink-0 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                      Available after analysis
                    </p>
                  ) : (
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                      <form action={action} aria-busy={pending}>
                      <HiddenSuggestionFields
                        conversationId={view.conversationId}
                        leadId={lead.id}
                        suggestion={suggestion}
                      />
                      <button
                        type="submit"
                        name="intent"
                        value={suggestion.conflict ? "REPLACE" : "APPLY"}
                        disabled={pending}
                        aria-label={
                          commandPending(command)
                            ? suggestion.conflict
                              ? `Replacing current ${fieldLabel.toLowerCase()}`
                              : `Applying suggested ${fieldLabel.toLowerCase()}`
                            : applyLabel
                        }
                        onClick={() => setSubmittedCommand(command)}
                        className={`${primaryButton} w-full sm:w-auto`}
                      >
                        {commandPending(command)
                          ? suggestion.conflict
                            ? "Replacing…"
                            : "Applying…"
                          : suggestion.conflict
                            ? "Replace current value"
                            : "Apply"}
                      </button>
                      </form>
                      <form action={action} aria-busy={pending}>
                      <HiddenSuggestionFields
                        conversationId={view.conversationId}
                        leadId={lead.id}
                        suggestion={suggestion}
                      />
                      <button
                        type="submit"
                        name="intent"
                        value="DISMISS"
                        disabled={pending}
                        aria-label={
                          commandPending(dismissCommand)
                            ? `Dismissing ${fieldLabel.toLowerCase()} suggestion`
                            : `Dismiss ${fieldLabel.toLowerCase()} suggestion`
                        }
                        onClick={() => setSubmittedCommand(dismissCommand)}
                        className={`${secondaryButton} w-full sm:w-auto`}
                      >
                        {commandPending(dismissCommand) ? "Dismissing…" : "Dismiss"}
                      </button>
                      </form>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {!view.refreshing && showApplyAvailable && (
          <form action={action} aria-busy={pending}>
            <input type="hidden" name="conversationId" value={view.conversationId} />
            <input type="hidden" name="expectedLeadId" value={lead.id} />
            {safeSuggestions.map((suggestion) => (
              <input
                key={suggestion.reviewFingerprint}
                type="hidden"
                name="reviewFingerprint"
                value={suggestion.reviewFingerprint}
              />
            ))}
            <button
              type="submit"
              name="intent"
              value="APPLY_ALL"
              disabled={pending}
              aria-label={
                commandPending("APPLY_ALL")
                  ? "Applying available contact details"
                  : "Apply available contact details"
              }
              onClick={() => setSubmittedCommand("APPLY_ALL")}
              className={`${primaryButton} w-full sm:w-auto`}
            >
              {commandPending("APPLY_ALL")
                ? "Applying available…"
                : "Apply available fields"}
            </button>
          </form>
        )}

        {!view.refreshing && showDismissAll && (
          <form action={action} aria-busy={pending}>
            <input type="hidden" name="conversationId" value={view.conversationId} />
            <input type="hidden" name="expectedLeadId" value={lead.id} />
            {suggestions.map((suggestion) => (
              <input
                key={suggestion.reviewFingerprint}
                type="hidden"
                name="reviewFingerprint"
                value={suggestion.reviewFingerprint}
              />
            ))}
            <button
              type="submit"
              name="intent"
              value="DISMISS_ALL"
              disabled={pending}
              aria-label={
                commandPending("DISMISS_ALL")
                  ? "Dismissing all contact suggestions"
                  : "Dismiss all contact suggestions"
              }
              onClick={() => setSubmittedCommand("DISMISS_ALL")}
              className={`${secondaryButton} w-full sm:w-auto`}
            >
              {commandPending("DISMISS_ALL") ? "Dismissing all…" : "Dismiss all"}
            </button>
          </form>
        )}

        {!view.refreshing && view.canRecheck && (
          <form action={action} aria-busy={pending}>
            <input type="hidden" name="conversationId" value={view.conversationId} />
            <button
              type="submit"
              name="intent"
              value="RECHECK"
              disabled={pending}
              aria-label={
                commandPending("RECHECK")
                  ? "Checking contact details"
                  : "Recheck contact details"
              }
              onClick={() => setSubmittedCommand("RECHECK")}
              className={`${secondaryButton} w-full sm:w-auto`}
            >
              {commandPending("RECHECK") ? "Checking…" : "Recheck"}
            </button>
          </form>
        )}
      </div>

      <ResultMessage state={feedbackState} pending={pending} lead={lead} />
    </section>
  );
}
