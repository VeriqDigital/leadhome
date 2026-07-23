"use client";
import { useActionState } from "react";
import type { LeadSource, LeadStatus } from "@prisma/client";
import type { ActionState } from "@/lib/validation";

type LeadValues = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source?: LeadSource;
  status?: LeadStatus;
  message?: string | null;
  estimatedValue?: string | null;
  nextFollowUpDate?: string | null;
};
const initial: ActionState = {};
const sources = ["MANUAL", "WEBSITE", "GMAIL", "FACEBOOK", "PHONE"] as const;
const statuses = [
  "NEW",
  "CONTACTED",
  "FOLLOW_UP",
  "PROPOSAL_SENT",
  "NEGOTIATING",
  "WON",
  "LOST",
] as const;
const label = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export function LeadForm({
  action,
  lead,
  submitLabel,
}: {
  action: (state: ActionState, data: FormData) => Promise<ActionState>;
  lead?: LeadValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="name"
          label="Name"
          required
          defaultValue={lead?.name}
          error={state.errors?.name?.[0]}
        />
        <Field name="company" label="Company" defaultValue={lead?.company} />
        <Field
          name="email"
          label="Email"
          type="email"
          defaultValue={lead?.email}
          error={state.errors?.email?.[0]}
        />
        <Field name="phone" label="Phone" defaultValue={lead?.phone} />
        <Select
          name="source"
          label="Source"
          values={sources}
          defaultValue={lead?.source ?? "MANUAL"}
        />
        <Select
          name="status"
          label="Status"
          values={statuses}
          defaultValue={lead?.status ?? "NEW"}
        />
        <Field
          name="estimatedValue"
          label="Estimated value"
          type="number"
          min="0"
          step="0.01"
          defaultValue={lead?.estimatedValue}
          error={state.errors?.estimatedValue?.[0]}
        />
        <Field
          name="nextFollowUpDate"
          label="Next follow-up"
          type="date"
          defaultValue={lead?.nextFollowUpDate}
        />
      </div>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold">
          Message or notes
        </span>
        <textarea
          name="message"
          defaultValue={lead?.message ?? ""}
          rows={5}
          className="w-full resize-y rounded-xl border border-black/9 bg-transparent px-3.5 py-3 text-sm outline-none focus:border-[#7770c8]"
        />
      </label>
      {state.message && (
        <p
          className={`rounded-lg px-3 py-2.5 text-sm ${state.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
          role="status"
        >
          {state.message}
        </p>
      )}
      <button
        disabled={pending}
        className="rounded-xl bg-[#17181c] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
function Field({
  label,
  error,
  defaultValue,
  ...props
}: {
  label: string;
  error?: string;
  defaultValue?: string | null;
  name: string;
  type?: string;
  required?: boolean;
  min?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      <input
        {...props}
        defaultValue={defaultValue ?? ""}
        className="h-11 w-full rounded-xl border border-black/9 bg-transparent px-3.5 text-sm outline-none focus:border-[#7770c8]"
      />
      {error && (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      )}
    </label>
  );
}
function Select({
  name,
  label: title,
  values,
  defaultValue,
}: {
  name: string;
  label: string;
  values: readonly string[];
  defaultValue: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{title}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="h-11 w-full rounded-xl border border-black/9 bg-transparent px-3.5 text-sm outline-none focus:border-[#7770c8]"
      >
        {values.map((value) => (
          <option key={value} value={value}>
            {label(value)}
          </option>
        ))}
      </select>
    </label>
  );
}
