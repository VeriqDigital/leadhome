"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveInboxControlsAction } from "@/app/actions/inbox-actions";
import {
  initialInboxMutationState,
  type InboxMutationState,
} from "./mutation-state";

const label = (value: string) =>
  value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());

function Result({ state }: { state: InboxMutationState }) {
  if (!state.message) return null;
  return <p
    role={state.success ? "status" : "alert"}
    aria-live="polite"
    className={!state.success
      ? "text-xs text-red-600"
      : state.changed
        ? "text-xs text-emerald-700 dark:text-emerald-300"
        : "text-xs text-[#687080]"}
  >
    {state.message}
  </p>;
}

export function ConversationControls({
  conversationId,
  leadId,
  leads,
  classification,
  reviewState,
  status,
}: {
  conversationId: string;
  leadId: string | null;
  leads: { id: string; name: string; email: string | null }[];
  classification: string;
  reviewState: string;
  status: string;
}) {
  const router = useRouter();
  const [selectedLeadId, setSelectedLeadId] = useState(leadId ?? "");
  const [selectedClassification, setSelectedClassification] = useState(classification);
  const [selectedReviewState, setSelectedReviewState] = useState(reviewState);
  const [selectedStatus, setSelectedStatus] = useState(status);
  const [result, action, pending] = useActionState(
    saveInboxControlsAction,
    initialInboxMutationState,
  );

  useEffect(() => {
    if (result.success && result.changed) router.refresh();
  }, [result, router]);

  const dirty =
    selectedLeadId !== (leadId ?? "") ||
    selectedClassification !== classification ||
    selectedReviewState !== reviewState ||
    selectedStatus !== status;

  return <form action={action} className="mt-4 space-y-2">
    <input type="hidden" name="conversationId" value={conversationId}/>
    <div className="flex flex-wrap items-center gap-2">
      <label>
        <span className="sr-only">Attached lead</span>
        <select
          aria-label="Attached lead"
          name="leadId"
          value={selectedLeadId}
          onChange={(event) => setSelectedLeadId(event.currentTarget.value)}
          className="min-w-64 rounded-lg border border-black/10 px-2 py-2 text-sm"
        >
          <option value="">No attached lead</option>
          {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}{lead.email ? ` — ${lead.email}` : ""}</option>)}
        </select>
      </label>
      <SelectControl
        name="classification"
        ariaLabel="Classification"
        value={selectedClassification}
        onChange={setSelectedClassification}
        options={["UNKNOWN", "LEAD", "CUSTOMER", "NEWSLETTER", "SPAM", "INTERNAL", "SYSTEM"]}
      />
      <SelectControl
        name="reviewState"
        ariaLabel="Review state"
        value={selectedReviewState}
        onChange={setSelectedReviewState}
        options={["NEEDS_REVIEW", "MATCHED", "IGNORED", "RESOLVED"]}
      />
      <SelectControl
        name="status"
        ariaLabel="Conversation status"
        value={selectedStatus}
        onChange={setSelectedStatus}
        options={["OPEN", "CLOSED", "ARCHIVED"]}
      />
      <button
        disabled={pending || !dirty}
        className="rounded-lg bg-[#17181c] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:border dark:border-white/10"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </div>
    <Result state={result}/>
  </form>;
}

function SelectControl({
  name,
  ariaLabel,
  value,
  onChange,
  options,
}: {
  name: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return <label>
    <span className="sr-only">{ariaLabel}</span>
    <select
      aria-label={ariaLabel}
      name={name}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="rounded-lg border border-black/10 px-2 py-2 text-xs"
    >
      {options.map((option) => <option value={option} key={option}>{label(option)}</option>)}
    </select>
  </label>;
}
