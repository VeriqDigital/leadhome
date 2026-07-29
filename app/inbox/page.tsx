import Link from "next/link";
import { Inbox } from "lucide-react";
import type {
  ConversationClassification, ConversationReviewState,
  ConversationStatus, MessageProvider,
} from "@prisma/client";
import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  conversationMessageDate,
  getConversationDetail, listConversationSummaries, type InboxFilters,
} from "@/lib/messaging/inbox-query";
import { getLatestGmailSyncJob } from "@/lib/jobs/service";
import { getConversationIntelligenceView } from "@/lib/ai/conversation-analysis/view-service";
import { GmailSyncForm } from "./gmail-sync-form";
import { ConversationControls } from "./conversation-controls";
import { ConversationIntelligenceCard } from "./conversation-intelligence-card";
import { completeTaskAction } from "@/app/actions/task-actions";
import { TaskDue } from "@/app/tasks/task-due";
import { GmailConnectLink } from "@/app/gmail-connect-link";

const reviews = ["NEEDS_REVIEW", "MATCHED", "IGNORED", "RESOLVED"] as const;
const classifications = ["UNKNOWN", "LEAD", "CUSTOMER", "NEWSLETTER", "SPAM", "INTERNAL", "SYSTEM"] as const;
const statuses = ["OPEN", "CLOSED", "ARCHIVED"] as const;
const providers = ["GMAIL", ...(process.env.NODE_ENV !== "production" ? ["FAKE" as const] : [])];
const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const compactDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
const valid = <T extends readonly string[]>(value: string | undefined, choices: T) =>
  value && choices.includes(value as T[number]) ? value as T[number] : undefined;

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
function href(params: Params, changes: Record<string, string | undefined>) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === "string" && value) result.set(key, value);
  for (const [key, value] of Object.entries(changes)) {
    if (value) result.set(key, value);
    else result.delete(key);
  }
  return `/inbox${result.size ? `?${result}` : ""}`;
}
function htmlToPlainText(html: string) {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const params = await searchParams;
  const pageValue = Number(one(params.page));
  const filters: InboxFilters = {
    query: one(params.q)?.slice(0, 100),
    reviewState: valid(one(params.review), reviews) as ConversationReviewState | undefined,
    classification: valid(one(params.classification), classifications) as ConversationClassification | undefined,
    status: valid(one(params.status), statuses) as ConversationStatus | undefined,
    provider: valid(one(params.provider), providers) as MessageProvider | undefined,
    attachment: valid(one(params.attachment), ["attached", "unattached"] as const),
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 10000) : 1,
  };
  const selectedId = one(params.conversation);
  const [list, detail, leads, gmail, intelligence] = await Promise.all([
    listConversationSummaries(user.id, filters),
    selectedId ? getConversationDetail(user.id, selectedId) : null,
    selectedId ? prisma.lead.findMany({
      where: { userId: user.id }, orderBy: { name: "asc" },
      select: { id: true, name: true, email: true }, take: 500,
    }) : Promise.resolve([]),
    prisma.communicationAccount.findFirst({
      where: { ownerId: user.id, provider: "GMAIL", status: { not: "DISCONNECTED" } },
      select: { id: true, address: true, status: true, lastImportedAt: true, lastImportSummary: true, lastSyncError: true },
    }),
    selectedId
      ? getConversationIntelligenceView(user.id, selectedId)
      : Promise.resolve(null),
  ]);
  const hasFilters = Boolean(filters.query || filters.reviewState || filters.classification || filters.status || filters.provider || filters.attachment);
  const gmailJob = gmail
    ? await getLatestGmailSyncJob(user.id, gmail.id)
    : null;
  const gmailSummary = gmail?.lastImportSummary as { conversationsCreated?: number; messagesCreated?: number } | null;

  return <div className="mx-auto max-w-[1500px]">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-3 text-3xl font-semibold tracking-[-0.04em]"><Inbox className="size-7"/>Inbox</h1>
        <p className="mt-2 text-sm text-[#687080]">Review imported conversations and connect them to leads.</p></div>
      {gmail ? gmail.status === "CONNECTED"
        ? <GmailSyncForm
            accountId={gmail.id}
            initialJob={gmailJob}
            lastSuccessfulSyncAt={gmail.lastImportedAt?.toISOString() ?? null}
            fallbackSummary={gmailSummary}
            fallbackError={gmail.lastSyncError}
          />
        : <div className="text-right">
            <GmailConnectLink reconnect className="rounded-xl border border-amber-300 px-4 py-2.5 text-sm font-semibold text-amber-800 dark:text-amber-300">Reconnect Gmail</GmailConnectLink>
            <p aria-live="polite" className="mt-2 max-w-md text-xs text-red-700 dark:text-red-300">{gmail.lastSyncError ?? "Reconnect Gmail to resume synchronization."}</p>
          </div>
        : <GmailConnectLink className="rounded-xl bg-[#17181c] px-4 py-2.5 text-sm font-semibold text-white">Connect Gmail</GmailConnectLink>}
    </header>

    <div className="inbox-shell mt-7 overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-[0_8px_30px_rgba(23,24,28,0.035)] lg:grid lg:min-h-[680px] lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
      <section aria-label="Conversation list" className={`${selectedId ? "hidden lg:block" : "block"} border-r border-black/[0.07]`}>
        <form action="/inbox" className="inbox-filters space-y-3 border-b border-black/[0.07] p-4">
          <label className="block"><span className="sr-only">Search conversations</span><input name="q" maxLength={100} defaultValue={filters.query} placeholder="Search subject, sender, or lead…" className="w-full rounded-xl border border-black/10 px-3.5 py-2.5 text-sm"/></label>
          <div className="grid grid-cols-2 gap-2">
            <Filter name="review" value={filters.reviewState} labelText="Review" options={reviews}/>
            <Filter name="classification" value={filters.classification} labelText="Classification" options={classifications}/>
            <Filter name="status" value={filters.status} labelText="Status" options={statuses}/>
            <Filter name="provider" value={filters.provider} labelText="Provider" options={providers}/>
            <Filter name="attachment" value={filters.attachment} labelText="Attachment" options={["attached", "unattached"]}/>
            <button className="rounded-lg bg-[#17181c] px-3 py-2 text-sm font-semibold text-white">Apply</button>
          </div>
          {hasFilters && <Link href="/inbox" className="inline-block text-xs font-semibold text-[#687080] underline">Clear search and filters</Link>}
        </form>
        <div>
          {list.items.map((conversation) => <Link
            key={conversation.id} href={href(params, { conversation: conversation.id })}
            aria-current={selectedId === conversation.id ? "true" : undefined}
            className={`inbox-row block border-b border-black/[0.06] p-4 focus-visible:outline focus-visible:outline-2 ${selectedId === conversation.id ? "inbox-row-selected bg-[#f0effb]" : "hover:bg-black/[0.025]"}`}
          >
            <div className="flex items-start justify-between gap-3"><h2 className="truncate text-sm font-semibold">{conversation.subject ?? "No subject"}</h2>
              <time className="shrink-0 text-[11px] text-[#7c828d]">
                {conversationMessageDate(conversation)
                  ? compactDate.format(conversationMessageDate(conversation)!)
                  : "No message date."}
              </time></div>
            <p className="mt-1 truncate text-xs font-medium text-[#565d69]">{conversation.latestMessage?.sender ?? "No participant"}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#777e89]">{conversation.latestMessage?.bodyPreview ?? "No message preview"}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]"><Badge text={label(conversation.provider)}/><Badge text={label(conversation.classification)}/><Badge text={label(conversation.reviewState)}/>
              {conversation.lead && <Badge text={conversation.lead.name}/>}</div>
          </Link>)}
          {!list.items.length && <div className="p-10 text-center text-sm text-[#687080]">{filters.query ? "No conversations match this search." : hasFilters ? "No conversations match these filters." : gmail?.lastImportedAt ? "No conversations have been imported." : "Sync Gmail to import conversations."}</div>}
        </div>
        <nav aria-label="Inbox pagination" className="flex items-center justify-between p-4 text-sm">
          {list.hasPrevious ? <Link className="rounded-lg border border-black/10 px-3 py-2" href={href(params, { page: String(filters.page - 1), conversation: undefined })}>Previous</Link> : <span/>}
          <span className="text-xs text-[#687080]">Page {filters.page}</span>
          {list.hasNext ? <Link className="rounded-lg border border-black/10 px-3 py-2" href={href(params, { page: String(filters.page + 1), conversation: undefined })}>Next</Link> : <span/>}
        </nav>
      </section>

      <section aria-label="Conversation detail" className={`${selectedId ? "block" : "hidden lg:block"} min-w-0`}>
        {selectedId && !detail ? <div className="grid min-h-[500px] place-items-center p-8 text-center"><div><p className="font-semibold">Conversation not found</p><p className="mt-2 text-sm text-[#687080]">It may have been removed or is not accessible.</p><Link href={href(params, { conversation: undefined })} className="mt-4 inline-block underline">Back to inbox</Link></div></div>
          : detail ? <ConversationDetail key={detail.id} detail={detail} leads={leads} backHref={href(params, { conversation: undefined })} intelligence={intelligence}/>
          : <div className="grid min-h-[500px] place-items-center p-8 text-center text-sm text-[#687080]">Select a conversation to review its messages.</div>}
      </section>
    </div>
  </div>;
}

function Filter({ name, value, labelText, options }: { name: string; value?: string; labelText: string; options: readonly string[] }) {
  return <label><span className="sr-only">{labelText}</span><select name={name} defaultValue={value ?? ""} className="w-full rounded-lg border border-black/10 bg-white px-2 py-2 text-xs"><option value="">All {labelText.toLowerCase()}</option>{options.map((option) => <option value={option} key={option}>{label(option)}</option>)}</select></label>;
}
function Badge({ text }: { text: string }) { return <span className="rounded-md bg-[#f1f2f4] px-2 py-1 text-[#555c68]">{text}</span>; }

function ConversationDetail({
  detail,
  leads,
  backHref,
  intelligence,
}: {
  detail: Awaited<ReturnType<typeof getConversationDetail>> & {};
  leads: { id: string; name: string; email: string | null }[];
  backHref: string;
  intelligence: Awaited<ReturnType<typeof getConversationIntelligenceView>>;
}) {
  const recipients = [...new Set(detail.messages.flatMap((message) => Array.isArray(message.recipients) ? message.recipients.filter((item): item is string => typeof item === "string") : []))];
  const candidateIds = Array.isArray(detail.matchCandidateLeadIds)
    ? detail.matchCandidateLeadIds.filter((item): item is string => typeof item === "string")
    : [];
  const candidates = leads.filter((lead) => candidateIds.includes(lead.id));
  return <div>
    <header className="inbox-detail-header border-b border-black/[0.07] p-5 sm:p-6"><Link href={backHref} className="mb-4 inline-block text-sm font-semibold underline lg:hidden">← Back to inbox</Link>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{detail.subject ?? "No subject"}</h2><p className="mt-1 text-sm text-[#687080]">{label(detail.provider)} · {detail.account.address ?? detail.account.displayName}</p></div>
        <div className="flex flex-wrap gap-1.5 text-xs"><Badge text={label(detail.status)}/><Badge text={label(detail.classification)}/><Badge text={label(detail.reviewState)}/></div></div>
      <p className="mt-3 text-xs text-[#687080]">Participants: {recipients.join(", ") || detail.messages.map((message) => message.sender).filter((value, index, all) => all.indexOf(value) === index).join(", ") || "Unknown"}</p>
      <div className="inbox-match mt-4 rounded-xl bg-[#f7f7f5] p-3 text-sm"><p><span className="font-semibold">Attached lead:</span> {detail.lead?.name ?? "None"}</p>
        <p className="mt-1 text-[#687080]"><span className="font-semibold text-[#343840]">Match:</span> {detail.manuallyDetached ? "Manually detached." : detail.matchReason ?? (detail.matchKind === "NO_MATCH" ? "No external participant matched." : "No match result is available.")}</p>
        {candidates.length > 0 && <p className="mt-1 text-[#687080]"><span className="font-semibold text-[#343840]">Possible leads:</span> {candidates.map((candidate) => candidate.name).join(", ")}</p>}
      </div>
      <ConversationControls
        key={`${detail.id}:${detail.lead?.id ?? "none"}:${detail.classification}:${detail.reviewState}:${detail.status}`}
        conversationId={detail.id}
        leadId={detail.lead?.id ?? null}
        leads={leads}
        classification={detail.classification}
        reviewState={detail.reviewState}
        status={detail.status}
      />
      {intelligence && (
        <ConversationIntelligenceCard
          key={`${intelligence.analysis?.updatedAt ?? "none"}:${intelligence.job?.updatedAt ?? "none"}`}
          conversationId={detail.id}
          initialView={intelligence}
        />
      )}
      <div className="mt-5 rounded-xl border border-black/[0.08] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Open tasks</h3>
          <div className="flex gap-3 text-xs font-semibold">
            {!detail.lead && (
              <Link
                href={`/inbox/${detail.id}/create-lead`}
                className="underline"
              >
                Create lead
              </Link>
            )}
            <Link
              href={`/tasks/new?conversation=${detail.id}&lead=${detail.lead?.id ?? ""}&type=FOLLOW_UP&title=${encodeURIComponent(`Follow up: ${detail.subject ?? "No subject"}`)}`}
              className="underline"
            >
              Create task
            </Link>
          </div>
        </div>
        {detail.tasks.length ? (
          <ul className="mt-3 divide-y divide-black/[0.07]">
            {detail.tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 py-2.5">
                <Link
                  href={`/tasks/${task.id}/edit`}
                  className="min-w-0 flex-1 truncate text-xs font-semibold hover:underline"
                >
                  {task.title}
                </Link>
                <span className="text-[11px]">
                  <TaskDue dueAt={task.dueAt?.toISOString() ?? null} overdue={Boolean(task.dueAt && task.dueAt < new Date())} />
                </span>
                <form action={completeTaskAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <button className="cursor-pointer rounded-lg border border-black/10 px-2.5 py-1.5 text-[11px] font-semibold">
                    Complete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-[#687080]">
            No open tasks for this conversation.
          </p>
        )}
      </div>
    </header>
    <div className="space-y-4 p-5 sm:p-6">{detail.messages.map((message) => {
      const text = message.bodyText?.trim() || (message.bodyHtml ? htmlToPlainText(message.bodyHtml) : "") || "No message body.";
      return <article key={message.id} className={`inbox-message max-w-[85%] rounded-2xl p-4 ${message.direction === "OUTBOUND" ? "inbox-message-outbound ml-auto bg-[#ebe9fa]" : "inbox-message-inbound bg-[#f3f4f5]"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold">{message.sender}</span><time className="text-[#707783]">{dateTime.format(message.receivedAt)}</time></div>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{text}</p>
        <p className="mt-3 text-[11px] text-[#777e89]">{label(message.direction)}{message.replyTo ? ` · Reply to ${message.replyTo}` : ""}</p>
      </article>;
    })}{!detail.messages.length && <p className="text-center text-sm text-[#687080]">This conversation has no stored messages.</p>}</div>
  </div>;
}
