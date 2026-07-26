import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  attachConversationAction,
  classifyConversationAction,
  detachConversationAction,
  reviewConversationAction,
} from "@/app/actions/message-actions";
import type { ImportSummary } from "@/lib/messaging/import-service";
import { ImportFakeForm } from "./import-fake-form";

const dateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function DevelopmentMessagesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const user = await requireUser();
  const [conversations, leads, latestAccount] = await Promise.all([
    prisma.conversation.findMany({
      where: { ownerId: user.id },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: 20,
      include: {
        account: { select: { displayName: true } },
        lead: { select: { id: true, name: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.lead.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.communicationAccount.findFirst({
      where: { ownerId: user.id },
      orderBy: { lastImportedAt: "desc" },
      select: { lastImportedAt: true, lastImportSummary: true },
    }),
  ]);
  const messageCount = conversations.reduce(
    (count, conversation) => count + conversation._count.messages,
    0,
  );
  const summary = latestAccount?.lastImportSummary as ImportSummary | null;

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7770c8]">
            Development only
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
            Messaging foundation
          </h1>
          <p className="dev-message-muted mt-2 text-sm text-[#687080]">
            Provider fixtures, stored conversations, ownership, and lead attachment.
          </p>
        </div>
        <ImportFakeForm />
      </header>

      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        <div className="dev-message-card rounded-xl border border-black/[0.06] bg-white p-4">
          <p className="dev-message-muted text-xs text-[#687080]">Conversations</p>
          <p className="mt-1 text-2xl font-semibold">{conversations.length}</p>
        </div>
        <div className="dev-message-card rounded-xl border border-black/[0.06] bg-white p-4">
          <p className="dev-message-muted text-xs text-[#687080]">Messages</p>
          <p className="mt-1 text-2xl font-semibold">{messageCount}</p>
        </div>
        <div className="dev-message-card rounded-xl border border-black/[0.06] bg-white p-4">
          <p className="dev-message-muted text-xs text-[#687080]">Last import</p>
          <p className="mt-1 text-sm font-semibold">
            {latestAccount?.lastImportedAt
              ? dateTime.format(latestAccount.lastImportedAt)
              : "Not run"}
          </p>
        </div>
      </div>

      {summary && (
        <section className="dev-message-card mt-4 rounded-xl border border-black/[0.06] bg-white p-4">
          <h2 className="text-sm font-semibold">Latest import summary</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 lg:grid-cols-7">
            {Object.entries(summary).map(([label, value]) => (
              <div key={label}>
                <dt className="dev-message-muted text-[#687080]">
                  {label.replace(/([A-Z])/g, " $1").toLowerCase()}
                </dt>
                <dd className="mt-1 font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <p className="dev-message-muted mt-6 text-xs text-[#687080]">Showing the newest 20 conversation summaries. Open the production Inbox to load one message thread at a time.</p>
      <div className="mt-4 space-y-5">
        {conversations.length === 0 ? (
          <div className="dev-message-empty rounded-2xl border border-dashed border-black/15 bg-white p-10 text-center text-sm text-[#687080]">
            No conversations yet. Import the development fixtures to begin.
          </div>
        ) : conversations.map((conversation) => (
          <section
            key={conversation.id}
            className="dev-message-card overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_8px_30px_rgba(23,24,28,0.035)]"
          >
            <div className="grid gap-4 border-b border-black/[0.06] p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{conversation.subject ?? "No subject"}</h2>
                  <span className="dev-message-badge rounded-md bg-[#f1f2f4] px-2 py-1 text-[11px] font-medium">
                    {conversation.status}
                  </span>
                  <span className="dev-message-badge rounded-md bg-[#f1f2f4] px-2 py-1 text-[11px] font-medium">
                    {conversation.classification}
                  </span>
                  <span className="dev-message-badge rounded-md bg-[#f1f2f4] px-2 py-1 text-[11px] font-medium">
                    {conversation.reviewState}
                  </span>
                </div>
                <p className="dev-message-muted mt-1 text-xs text-[#687080]">
                  {conversation.provider} · {conversation.account.displayName} ·{" "}
                  {conversation.providerConversationId}
                </p>
                <p className="mt-2 text-sm">
                  Attached lead:{" "}
                  <span className="font-medium">
                    {conversation.lead?.name ?? "Unattached"}
                  </span>
                </p>
                <p className="dev-message-muted mt-1 text-xs text-[#687080]">
                  Match: {conversation.matchKind ?? "NOT_RUN"} ·{" "}
                  {conversation.matchReason ?? "No match result yet"}
                </p>
                <p className="dev-message-muted mt-1 text-xs text-[#687080]">
                  Last message:{" "}
                  {conversation.lastMessageAt
                    ? dateTime.format(conversation.lastMessageAt)
                    : "None"}
                </p>
              </div>
              <div className="flex max-w-xl flex-wrap items-center justify-end gap-2">
                <form action={attachConversationAction} className="flex gap-2">
                  <input type="hidden" name="conversationId" value={conversation.id} />
                  <select
                    key={`${conversation.id}:lead:${conversation.leadId ?? "unattached"}`}
                    name="leadId"
                    defaultValue={conversation.leadId ?? ""}
                    required
                    className="dev-message-control rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  >
                    <option value="" disabled>Select lead</option>
                    {leads.map((lead) => (
                      <option key={lead.id} value={lead.id}>{lead.name}</option>
                    ))}
                  </select>
                  <button className="dev-message-control rounded-lg border border-black/10 px-3 py-2 text-sm font-medium">
                    Attach
                  </button>
                </form>
                {conversation.leadId && (
                  <form action={detachConversationAction}>
                    <input type="hidden" name="conversationId" value={conversation.id} />
                    <button className="dev-message-muted rounded-lg px-3 py-2 text-sm text-[#687080]">
                      Detach
                    </button>
                  </form>
                )}
                <form action={classifyConversationAction} className="flex gap-2">
                  <input type="hidden" name="conversationId" value={conversation.id} />
                  <select
                    key={`${conversation.id}:classification:${conversation.classification}`}
                    name="classification"
                    defaultValue={conversation.classification}
                    className="dev-message-control rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  >
                    {["UNKNOWN", "LEAD", "CUSTOMER", "NEWSLETTER", "SPAM", "INTERNAL", "SYSTEM"].map(
                      (classification) => (
                        <option key={classification}>{classification}</option>
                      ),
                    )}
                  </select>
                  <button className="dev-message-control rounded-lg border border-black/10 px-3 py-2 text-sm font-medium">
                    Classify
                  </button>
                </form>
                <form action={reviewConversationAction} className="flex gap-2">
                  <input type="hidden" name="conversationId" value={conversation.id} />
                  <select
                    key={`${conversation.id}:review:${conversation.reviewState}`}
                    name="reviewState"
                    defaultValue={conversation.reviewState}
                    className="dev-message-control rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                  >
                    {["NEEDS_REVIEW", "MATCHED", "IGNORED", "RESOLVED"].map(
                      (reviewState) => (
                        <option key={reviewState}>{reviewState}</option>
                      ),
                    )}
                  </select>
                  <button className="dev-message-control rounded-lg border border-black/10 px-3 py-2 text-sm font-medium">
                    Set review
                  </button>
                </form>
              </div>
            </div>
            <div className="border-t border-black/[0.05] p-4 text-xs text-[#687080]">
              {conversation._count.messages} stored messages · Provider conversation ID: {conversation.providerConversationId}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
