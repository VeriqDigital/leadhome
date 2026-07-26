"use client";

import { useFormStatus } from "react-dom";
import { syncGmailAction } from "@/app/actions/gmail-actions";

function SyncButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending} aria-live="polite" className="rounded-xl bg-[#17181c] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
    {pending ? "Syncing…" : "Sync Gmail"}
  </button>;
}

export function GmailSyncForm({ accountId }: { accountId: string }) {
  return <form action={syncGmailAction}>
    <input type="hidden" name="accountId" value={accountId}/>
    <SyncButton/>
  </form>;
}
