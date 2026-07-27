"use client";

import { useActionState } from "react";
import {
  setConversationIntelligencePreferenceAction,
  type ConversationIntelligencePreferenceState,
} from "@/app/actions/conversation-intelligence-settings-actions";

const initialState: ConversationIntelligencePreferenceState = {
  success: false,
  message: "",
};

const dateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateTime.format(date);
}

export function ConversationIntelligenceSettings({
  enabled,
  configurationAvailable,
  configurationMessage,
  latestSuccessfulAnalysisAt,
}: {
  enabled: boolean;
  configurationAvailable: boolean;
  configurationMessage: string;
  latestSuccessfulAnalysisAt: string | null;
}) {
  const [state, action, pending] = useActionState(
    setConversationIntelligencePreferenceAction,
    initialState,
  );
  const currentEnabled =
    state.success && typeof state.enabled === "boolean"
      ? state.enabled
      : enabled;
  const enablingBlocked = !currentEnabled && !configurationAvailable;
  const latestSuccess = formatDate(latestSuccessfulAnalysisAt);

  return (
    <section aria-labelledby="conversation-intelligence-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3
              id="conversation-intelligence-title"
              className="text-base font-semibold"
            >
              Conversation Intelligence
            </h3>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                currentEnabled
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
                  : "bg-neutral-100 text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-400"
              }`}
            >
              {currentEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[#687080] dark:text-neutral-400">
            Analyze eligible lead conversations to create summaries, extract
            useful business details, and suggest follow-up actions. Email text
            from eligible conversations is sent to the configured OpenAI API.
            Attachments are not included.
          </p>
          <p className="mt-2 text-xs leading-5 text-[#858b96] dark:text-neutral-500">
            Only eligible lead-linked conversations are analyzed automatically
            after their content changes. Enabling this setting does not scan or
            backfill your existing inbox.
          </p>
        </div>
      </div>

      <div
        className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
          configurationAvailable
            ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/[0.07] dark:text-emerald-300"
            : "border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/[0.07] dark:text-amber-300"
        }`}
      >
        <p className="font-semibold">
          {configurationAvailable
            ? "AI provider is ready"
            : "AI provider setup is incomplete"}
        </p>
        <p className="mt-1 text-xs leading-5">{configurationMessage}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <form action={action}>
          <input
            type="hidden"
            name="enabled"
            value={String(!currentEnabled)}
          />
          <button
            disabled={pending || enablingBlocked}
            className="cursor-pointer rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.05]"
          >
            {pending
              ? "Saving…"
              : currentEnabled
                ? "Disable Conversation Intelligence"
                : "Enable Conversation Intelligence"}
          </button>
        </form>
        {latestSuccess && (
          <p className="text-xs text-[#687080] dark:text-neutral-400">
            Latest successful analysis:{" "}
            <time dateTime={latestSuccessfulAnalysisAt ?? undefined}>
              {latestSuccess}
            </time>
          </p>
        )}
      </div>

      {state.message && (
        <p
          role={state.success ? "status" : "alert"}
          aria-live="polite"
          className={`mt-3 text-sm ${
            state.success
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-red-700 dark:text-red-300"
          }`}
        >
          {state.message}
        </p>
      )}
    </section>
  );
}
