import { Reply } from "lucide-react";
import type { MessageProvider } from "@prisma/client";

const gmailThreadIdPattern = /^[a-f0-9]+$/i;

export function gmailThreadUrl({
  accountAddress,
  providerConversationId,
}: {
  accountAddress: string | null;
  providerConversationId: string;
}) {
  const address = accountAddress?.trim();
  const threadId = providerConversationId.trim();
  if (
    !address ||
    !threadId ||
    threadId.length > 128 ||
    !gmailThreadIdPattern.test(threadId)
  ) {
    return null;
  }

  const url = new URL("https://mail.google.com/mail/u/");
  url.searchParams.set("authuser", address);
  url.hash = `all/${threadId}`;
  return url.toString();
}

export function GmailReplyLink({
  provider,
  providerConversationId,
  accountAddress,
}: {
  provider: MessageProvider;
  providerConversationId: string;
  accountAddress: string | null;
}) {
  if (provider !== "GMAIL") return null;

  const href = gmailThreadUrl({ accountAddress, providerConversationId });
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="action-primary inline-flex min-h-9 items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-xs font-semibold"
    >
      <Reply aria-hidden className="size-3.5" />
      Reply in Gmail
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
