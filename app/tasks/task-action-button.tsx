"use client";

import { useFormStatus } from "react-dom";

export function TaskActionButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      aria-disabled={pending}
      aria-live="polite"
      className={
        className ??
        "min-w-18 cursor-pointer rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold transition-opacity hover:bg-black/[0.03] disabled:cursor-wait disabled:opacity-60 dark:hover:bg-white/[0.05]"
      }
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
