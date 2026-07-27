import "server-only";

import type { gmail_v1 } from "googleapis";
import type { MessageProvider, NormalizedConversation, NormalizedMessage } from "./provider";
import { createGmailClient } from "@/lib/gmail/gmail-client";

const MAX_GMAIL_REQUEST_MS = 10_000;
const DEADLINE_CUSHION_MS = 1_000;

export class GmailRequestDeadlineError extends Error {
  readonly code = "ETIMEDOUT";

  constructor() {
    super("The Gmail request exceeded the job execution window.");
    this.name = "GmailRequestDeadlineError";
  }
}

export function gmailRequestTimeoutMs(
  deadlineAt?: number,
  now = Date.now(),
) {
  if (deadlineAt === undefined) return MAX_GMAIL_REQUEST_MS;
  const remaining = deadlineAt - now - DEADLINE_CUSHION_MS;
  if (remaining < 1_000) throw new GmailRequestDeadlineError();
  return Math.min(MAX_GMAIL_REQUEST_MS, remaining);
}

export function boundedGmailThreadLimit(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, 100)
    : 50;
}

const DEFAULT_MAX_THREADS = boundedGmailThreadLimit(
  process.env.GMAIL_SYNC_THREAD_LIMIT,
);
const header = (message: gmail_v1.Schema$Message, name: string) =>
  message.payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
const addresses = (value: string | null) =>
  value?.split(",").map((item) => (item.match(/<([^>]+)>/)?.[1] ?? item).trim().toLowerCase()).filter(Boolean) ?? [];
const decode = (value?: string | null) => {
  if (!value) return null;
  try { return Buffer.from(value, "base64url").toString("utf8"); } catch { return null; }
};

function bodies(part?: gmail_v1.Schema$MessagePart): { text: string[]; html: string[] } {
  const result = { text: [] as string[], html: [] as string[] };
  if (!part) return result;
  const content = decode(part.body?.data);
  if (content && part.mimeType === "text/plain") result.text.push(content);
  if (content && part.mimeType === "text/html") result.html.push(content);
  for (const child of part.parts ?? []) {
    const nested = bodies(child);
    result.text.push(...nested.text);
    result.html.push(...nested.html);
  }
  return result;
}

export class GmailProvider implements MessageProvider {
  readonly provider = "GMAIL" as const;
  private client?: Awaited<ReturnType<typeof createGmailClient>>;
  constructor(
    private accountId: string,
    private ownerId: string,
    private threadLimit = DEFAULT_MAX_THREADS,
    private deadlineAt?: number,
  ) {
    this.threadLimit = boundedGmailThreadLimit(threadLimit);
  }
  private async getClient() { return (this.client ??= await createGmailClient(this.accountId, this.ownerId)); }
  async getAccount() {
    const { account } = await this.getClient();
    return { provider: this.provider, providerAccountId: account.providerAccountId, displayName: account.displayName, address: account.address };
  }
  async listRecentConversations(): Promise<NormalizedConversation[]> {
    const { gmail } = await this.getClient();
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < this.threadLimit) {
      const response = await gmail.users.threads.list({
        userId: "me", q: "newer_than:30d in:inbox -in:spam -in:trash",
        maxResults: Math.min(50, this.threadLimit - ids.length), pageToken,
      }, { timeout: gmailRequestTimeoutMs(this.deadlineAt) });
      ids.push(...(response.data.threads ?? []).flatMap((thread) => thread.id ? [thread.id] : []));
      pageToken = response.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    return ids.map((providerConversationId) => ({ providerConversationId }));
  }
  async getConversation(providerConversationId: string) {
    const messages = await this.listMessages(providerConversationId);
    if (!messages.length) return null;
    return { providerConversationId, subject: messages.at(-1)?.subject ?? null };
  }
  async listMessages(providerConversationId: string): Promise<NormalizedMessage[]> {
    const { gmail, account } = await this.getClient();
    const response = await gmail.users.threads.get(
      { userId: "me", id: providerConversationId, format: "full" },
      { timeout: gmailRequestTimeoutMs(this.deadlineAt) },
    );
    return (response.data.messages ?? []).flatMap((message) => {
      if (!message.id) return [];
      const from = header(message, "From") ?? "";
      const sender = addresses(from)[0] ?? from;
      const to = addresses(header(message, "To"));
      const cc = addresses(header(message, "Cc"));
      const bcc = addresses(header(message, "Bcc"));
      const content = bodies(message.payload);
      const occurredAt = new Date(Number(message.internalDate ?? Date.now()));
      if (Number.isNaN(occurredAt.getTime())) return [];
      return [{
        providerMessageId: message.id,
        direction: sender === account.address?.toLowerCase() ? "OUTBOUND" as const : "INBOUND" as const,
        sender, recipients: [...new Set([...to, ...cc, ...bcc])],
        replyTo: addresses(header(message, "Reply-To"))[0] ?? null,
        subject: header(message, "Subject"),
        bodyText: content.text.join("\n").trim() || null,
        bodyHtml: content.html.join("\n").trim() || null,
        occurredAt,
        internetMessageId: header(message, "Message-ID"),
        inReplyTo: header(message, "In-Reply-To"),
        references: header(message, "References")?.split(/\s+/).filter(Boolean),
        metadata: { threadId: providerConversationId, labelIds: message.labelIds ?? [] },
      }];
    }).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }
}
