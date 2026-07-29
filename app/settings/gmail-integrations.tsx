import Link from "next/link";
import type { GmailSyncJobView } from "@/lib/jobs/types";
import { GmailSyncForm } from "@/app/inbox/gmail-sync-form";
import { GmailConnectButton } from "@/app/gmail-connect-button";
import { DisconnectGmailForm } from "./disconnect-gmail-form";

type GmailAccount = {
  id: string; address: string | null; displayName: string; status: string;
  lastImportedAt: Date | null; lastImportSummary: unknown; lastSyncError: string | null;
  latestJob: GmailSyncJobView | null;
};

export function GmailIntegrations({ accounts }: { accounts: GmailAccount[] }) {
  return <section>
    <h3 className="text-base font-semibold">Integrations</h3>
    <p className="mt-1 text-sm text-[#687080]">Connect one Gmail mailbox independently from your LeadHome sign-in.</p>
    {!accounts.length && <GmailConnectButton className="mt-4 inline-flex rounded-xl bg-[#17181c] px-4 py-2.5 text-sm font-semibold text-white">Connect Gmail</GmailConnectButton>}
    <div className="mt-4 space-y-3">{accounts.map((account) => (
      <article key={account.id} className="rounded-xl border border-black/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-semibold">{account.address ?? account.displayName}</p>
          <p className="text-sm text-[#687080]">{account.status === "RECONNECT_REQUIRED" ? "Reconnect required" : account.status.toLowerCase()}</p></div>
          <div className="flex flex-wrap gap-2">
            {account.status === "CONNECTED" && <GmailSyncForm
              accountId={account.id}
              initialJob={account.latestJob}
              lastSuccessfulSyncAt={account.lastImportedAt?.toISOString() ?? null}
              fallbackSummary={account.lastImportSummary as {
                conversationsCreated?: number;
                messagesCreated?: number;
              } | null}
              fallbackError={account.lastSyncError}
              variant="settings"
            />}
            {account.status !== "CONNECTED" && <GmailConnectButton reconnect className="rounded-lg border border-black/10 px-3 py-2 text-sm">Reconnect</GmailConnectButton>}
            {account.status !== "DISCONNECTED" && <DisconnectGmailForm accountId={account.id} />}
          </div>
        </div>
        {account.status !== "CONNECTED" && <p className="mt-3 text-xs text-[#687080]">Last successful sync: {account.lastImportedAt?.toLocaleString() ?? "Never"}</p>}
        {account.status !== "CONNECTED" && account.lastSyncError && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{account.lastSyncError}</p>}
        {process.env.NODE_ENV !== "production" && account.lastImportedAt && <Link href="/dev/messages" className="mt-2 inline-block text-sm font-semibold underline">Review imported conversations</Link>}
      </article>
    ))}</div>
  </section>;
}
