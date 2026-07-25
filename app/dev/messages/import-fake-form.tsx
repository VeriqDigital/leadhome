"use client";

import { useActionState } from "react";
import {
  importFakeMessagesAction,
  type ImportFakeMessagesState,
} from "@/app/actions/message-actions";

const initialState: ImportFakeMessagesState = {};

export function ImportFakeForm() {
  const [state, action, pending] = useActionState(
    importFakeMessagesAction,
    initialState,
  );
  const tone =
    state.status === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
      : state.status === "success"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";

  return (
    <div className="flex max-w-md flex-col items-end gap-2">
      <form action={action}>
        <button
          disabled={pending}
          className="dev-message-import rounded-xl bg-[#17181c] px-4 py-2.5 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Importing…" : "Import fake fixtures"}
        </button>
      </form>
      {state.message && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-lg border px-3 py-2 text-xs ${tone}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
