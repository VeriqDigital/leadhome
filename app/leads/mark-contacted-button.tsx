"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation";

const initialState: ActionState = {};

export function MarkContactedButton({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="text-right">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!window.confirm("Record this lead as contacted?")) {
            event.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          className="action-primary min-h-10 rounded-lg border border-transparent px-3.5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Recording…" : "Mark as contacted"}
        </button>
      </form>
      {state.message ? (
        <p
          aria-live="polite"
          className={`mt-1.5 max-w-56 text-xs ${
            state.success ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
