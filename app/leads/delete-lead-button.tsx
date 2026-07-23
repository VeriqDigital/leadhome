"use client";
import { Trash2 } from "lucide-react";
export function DeleteLeadButton({ action }: { action: () => Promise<void> }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!confirm("Delete this lead? This action cannot be undone."))
          event.preventDefault();
      }}
    >
      <button className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50">
        <Trash2 className="size-4" />
        Delete lead
      </button>
    </form>
  );
}
