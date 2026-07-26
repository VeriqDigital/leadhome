"use client";

import { disconnectGmailAction } from "@/app/actions/gmail-actions";

export function DisconnectGmailForm({ accountId }: { accountId: string }) {
  return <form
    action={disconnectGmailAction}
    onSubmit={(event) => {
      if (!window.confirm("Disconnect Gmail? Imported conversations will be preserved and your LeadHome login will not change.")) {
        event.preventDefault();
      }
    }}
  >
    <input type="hidden" name="accountId" value={accountId}/>
    <button className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">Disconnect</button>
  </form>;
}
