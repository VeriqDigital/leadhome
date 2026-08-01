import { Mail } from "lucide-react";
import { normalizeEmailAddresses } from "@/lib/messaging/participant-identity";

export function gmailComposeUrl({
  recipient,
  accountAddress,
}: {
  recipient: string | null;
  accountAddress: string | null;
}) {
  const normalizedRecipient = normalizeEmailAddresses(recipient)[0];
  if (!normalizedRecipient) return null;

  const url = new URL("https://mail.google.com/mail/u/");
  const normalizedAccount = normalizeEmailAddresses(accountAddress)[0];
  if (normalizedAccount) url.searchParams.set("authuser", normalizedAccount);
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  url.searchParams.set("to", normalizedRecipient);
  return url.toString();
}

export function GmailComposeLink({
  recipient,
  leadName,
  accountAddress,
  label = "Email in Gmail",
  compact = false,
}: {
  recipient: string | null;
  leadName: string;
  accountAddress: string | null;
  label?: string;
  compact?: boolean;
}) {
  const href = gmailComposeUrl({ recipient, accountAddress });
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Email ${leadName} in Gmail`}
      className={`action-primary inline-flex items-center justify-center gap-2 rounded-lg border border-transparent font-semibold ${
        compact ? "min-h-8 px-2.5 py-1.5 text-xs" : "min-h-10 px-3.5 py-2 text-sm"
      }`}
    >
      <Mail aria-hidden className="size-3.5" />
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
