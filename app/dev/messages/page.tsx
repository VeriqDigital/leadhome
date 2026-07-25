import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  attachConversationAction,
  detachConversationAction,
  importFakeMessagesAction,
} from "@/app/actions/message-actions";

const dateTime = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function DevelopmentMessagesPage() {
  const user = await requireUser();
  const [conversations, leads] = await Promise.all([
    prisma.conversation.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        account: { select: { displayName: true } },
        lead: { select: { id: true, name: true } },
        messages: { orderBy: { receivedAt: "asc" } },
      },
    }),
    prisma.lead.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

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
        <form action={importFakeMessagesAction}>
          <button className="dev-message-import rounded-xl bg-[#17181c] px-4 py-2.5 text-sm font-medium text-white">
            Import fake fixtures
          </button>
        </form>
      </header>

      <div className="mt-8 space-y-5">
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
              </div>
              <div className="flex items-center gap-2">
                <form action={attachConversationAction} className="flex gap-2">
                  <input type="hidden" name="conversationId" value={conversation.id} />
                  <select
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
              </div>
            </div>
            <div className="divide-y divide-black/[0.05]">
              {conversation.messages.map((message) => (
                <article key={message.id} className="grid gap-2 p-5 md:grid-cols-[150px_1fr]">
                  <div className="dev-message-muted text-xs text-[#687080]">
                    <p className="dev-message-primary font-semibold text-[#343840]">{message.direction}</p>
                    <p className="mt-1">{dateTime.format(message.receivedAt)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{message.sender}</p>
                    <p className="dev-message-muted mt-1 text-sm text-[#687080]">{message.bodyText}</p>
                    <p className="dev-message-subtle mt-2 text-[11px] text-[#9298a3]">
                      {message.providerMessageId}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
