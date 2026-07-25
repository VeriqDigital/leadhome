"use client";
import { useActionState, useState, useTransition } from "react";
import {
  sourceLabels,
  sourceValues,
  statusLabels,
  statusValues,
} from "@/lib/lead-format";
import type {
  CanonicalLead,
  LeadFormInput,
  LeadFormValues,
} from "@/lib/lead-types";
import type { ActionState } from "@/lib/validation";

export const canonicalFormValues = (
  lead?: LeadFormInput | CanonicalLead,
): LeadFormValues => ({
  name: lead?.name ?? "",
  email: lead?.email ?? "",
  phone: lead?.phone ?? "",
  company: lead?.company ?? "",
  source: lead?.source ?? "MANUAL",
  status: lead?.status ?? "NEW",
  message: lead?.message ?? "",
  estimatedValue: lead?.estimatedValue ?? "",
  nextFollowUp: lead?.nextFollowUp ?? "",
});
const initial: ActionState = {};
export function SaveResultMessage({ state }: { state: ActionState }) {
  const tone = !state.success
    ? "error"
    : state.changed === false
      ? "neutral"
      : "success";
  const styles = {
    error: "bg-red-50 text-red-700",
    neutral:
      "bg-[#f1f2f4] text-[#5e6674] dark:bg-[#292b31] dark:text-[#b7bbc5]",
    success: "bg-green-50 text-green-700",
  };
  return (
    <div className="min-h-10" aria-live="polite" aria-atomic="true">
      {state.message && (
        <p
          className={`rounded-lg px-3 py-2.5 text-sm ${styles[tone]}`}
          role="status"
          data-tone={tone}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
export function LeadForm({
  action,
  lead,
  submitLabel,
}: {
  action: (state: ActionState, data: FormData) => Promise<ActionState>;
  lead?: LeadFormInput;
  submitLabel: string;
}) {
  const [fields, setFields] = useState<LeadFormValues>(() =>
    canonicalFormValues(lead),
  );
  const [state, formAction, actionPending] = useActionState(
    (previous: ActionState, data: FormData) => action(previous, data),
    initial,
  );
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;
  const [synchronizedLead, setSynchronizedLead] = useState(state.lead);
  if (state.lead && state.lead !== synchronizedLead) {
    setSynchronizedLead(state.lead);
    setFields(canonicalFormValues(state.lead));
  }
  const update = (field: keyof LeadFormValues, value: string) => {
    setFields((current) => ({ ...current, [field]: value }));
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="space-y-6"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="name"
          label="Name"
          required
          value={fields.name}
          onChange={(value) => update("name", value)}
          error={state.errors?.name?.[0]}
        />
        <Field
          name="company"
          label="Company"
          value={fields.company}
          onChange={(value) => update("company", value)}
        />
        <Field
          name="email"
          label="Email"
          type="email"
          value={fields.email}
          onChange={(value) => update("email", value)}
          error={state.errors?.email?.[0]}
        />
        <Field
          name="phone"
          label="Phone"
          value={fields.phone}
          onChange={(value) => update("phone", value)}
        />
        <Select
          name="source"
          label="Source"
          values={sourceValues}
          value={fields.source}
          labelFor={(value) => sourceLabels[value]}
          onChange={(value) => update("source", value)}
        />
        <Select
          name="status"
          label="Status"
          values={statusValues}
          value={fields.status}
          labelFor={(value) => statusLabels[value]}
          onChange={(value) => update("status", value)}
        />
        <Field
          name="estimatedValue"
          label="Estimated value"
          type="number"
          min="0"
          step="0.01"
          value={fields.estimatedValue}
          onChange={(value) => update("estimatedValue", value)}
          error={state.errors?.estimatedValue?.[0]}
        />
        <Field
          name="nextFollowUp"
          label="Next follow-up"
          type="date"
          value={fields.nextFollowUp}
          onChange={(value) => update("nextFollowUp", value)}
        />
      </div>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold">
          Message or notes
        </span>
        <textarea
          name="message"
          value={fields.message}
          onChange={(event) => update("message", event.target.value)}
          rows={5}
          className="w-full resize-y rounded-xl border border-black/9 bg-transparent px-3.5 py-3 text-sm outline-none focus:border-[#7770c8]"
        />
      </label>
      <SaveResultMessage state={state} />
      <button
        type="submit"
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
  value,
  onChange,
  ...props
}: {
  label: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
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
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-black/9 bg-transparent px-3.5 text-sm outline-none focus:border-[#7770c8]"
      />
      {error && (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      )}
    </label>
  );
}
function Select<T extends string>({
  name,
  label: title,
  values,
  value,
  labelFor,
  onChange,
}: {
  name: string;
  label: string;
  values: readonly T[];
  value: T;
  labelFor: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{title}</span>
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-11 w-full rounded-xl border border-black/9 bg-transparent px-3.5 text-sm outline-none focus:border-[#7770c8]"
      >
        {values.map((value) => (
          <option key={value} value={value}>
            {labelFor(value)}
          </option>
        ))}
      </select>
    </label>
  );
}
