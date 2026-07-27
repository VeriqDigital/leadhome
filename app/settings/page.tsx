import { Settings } from "lucide-react";
import { SectionPage } from "../section-page";
import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { WebsiteSources } from "./website-sources";
import { headers } from "next/headers";
import { GmailIntegrations } from "./gmail-integrations";
import { linkGoogleAction, unlinkGoogleAction } from "@/app/actions/auth-actions";
import { listRecentJobs } from "@/lib/jobs/service";
import { conversationAnalysisConfigurationStatus } from "@/lib/ai/config";
import { latestSuccessfulConversationAnalysisAt } from "@/lib/ai/conversation-analysis/job-service";
import { ConversationIntelligenceSettings } from "./conversation-intelligence-settings";

export default async function SettingsPage() {
  const user = await requireUser();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  const endpoint = host
    ? `${protocol}://${host}/api/inbound/forms`
    : "http://localhost:3000/api/inbound/forms";
  const conversationAnalysisConfiguration =
    conversationAnalysisConfigurationStatus();
  const [
    sources,
    loginUser,
    gmailAccounts,
    recentGmailJobs,
    latestSuccessfulAnalysisAt,
  ] = await Promise.all([
    prisma.inboundSource.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, isActive: true, createdAt: true },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        passwordHash: true,
        conversationIntelligenceEnabled: true,
        accounts: { select: { provider: true } },
      },
    }),
    prisma.communicationAccount.findMany({
      where: { ownerId: user.id, provider: "GMAIL" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        address: true,
        displayName: true,
        status: true,
        lastImportedAt: true,
        lastImportSummary: true,
        lastSyncError: true,
      },
    }),
    listRecentJobs(user.id, { type: "GMAIL_SYNC", limit: 100 }),
    latestSuccessfulConversationAnalysisAt(user.id),
  ]);
  const gmailAccountsWithJobs = gmailAccounts.map((account) => ({
      ...account,
      latestJob: recentGmailJobs.find(
        (job) => job.communicationAccountId === account.id,
      ) ?? null,
    }));
  const hasGoogle = loginUser?.accounts.some((account) => account.provider === "google") ?? false;
  const canUnlinkGoogle = hasGoogle && (Boolean(loginUser?.passwordHash) || (loginUser?.accounts.length ?? 0) > 1);
  return (
    <SectionPage
      title="Settings"
      description="Manage your LeadHome workspace preferences."
      icon={Settings}
    >
      <div className="max-w-3xl space-y-8">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Display name</span>
            <input readOnly value={user.name ?? ""} className="w-full rounded-xl border border-black/[0.09] bg-transparent px-4 py-3 text-sm" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Account email</span>
            <input readOnly value={user.email ?? ""} className="w-full rounded-xl border border-black/[0.09] bg-transparent px-4 py-3 text-sm" />
          </label>
        </div>
        <p className="text-xs text-[#687080]">
          Appearance can be changed from the profile menu in the lower-left
          corner.
        </p>
        <div className="border-t border-black/[0.07] pt-8">
          <h3 className="text-base font-semibold">Account security</h3>
          <p className="mt-1 text-sm text-[#687080]">Password login: {loginUser?.passwordHash ? "Available" : "Not configured"}</p>
          <p className="mt-1 text-sm text-[#687080]">Google sign-in: {hasGoogle ? "Linked" : "Not linked"}</p>
          <form action={hasGoogle ? unlinkGoogleAction : linkGoogleAction} className="mt-3">
            <button disabled={hasGoogle && !canUnlinkGoogle} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
              {hasGoogle ? "Unlink Google" : "Link Google sign-in"}
            </button>
          </form>
          {hasGoogle && !canUnlinkGoogle && <p className="mt-2 text-xs text-[#687080]">Google cannot be unlinked because it is your only login method.</p>}
        </div>
        <div className="border-t border-black/[0.07] pt-8">
          <ConversationIntelligenceSettings
            enabled={loginUser?.conversationIntelligenceEnabled ?? false}
            configurationAvailable={conversationAnalysisConfiguration.available}
            configurationMessage={conversationAnalysisConfiguration.message}
            latestSuccessfulAnalysisAt={
              latestSuccessfulAnalysisAt?.toISOString() ?? null
            }
          />
        </div>
        <div className="border-t border-black/[0.07] pt-8">
          <GmailIntegrations accounts={gmailAccountsWithJobs} />
        </div>
        <div className="border-t border-black/[0.07] pt-8">
          <WebsiteSources endpoint={endpoint} sources={sources.map((source) => ({ ...source, createdAt: source.createdAt.toISOString() }))} />
        </div>
      </div>
    </SectionPage>
  );
}
