import { domainToASCII } from "node:url";
import { isIP } from "node:net";

import type { MessageDirection } from "@prisma/client";

export const MAX_EXTERNAL_IDENTITY_MESSAGES = 100;

const SYSTEM_ONLY_LOCAL_PARTS = new Set([
  "do-not-reply",
  "donotreply",
  "mailer-daemon",
  "no-reply",
  "noreply",
  "postmaster",
]);

const NON_PUBLIC_DNS_SUFFIXES = new Set([
  "example",
  "internal",
  "invalid",
  "local",
  "localhost",
  "onion",
  "test",
]);

type ParticipantIdentityMessage = {
  direction: MessageDirection;
  sender?: string | null;
  replyTo?: string | null;
  recipients?: readonly string[] | null;
};

type ExcludedAddresses =
  | string
  | readonly (string | null | undefined)[]
  | null
  | undefined;

export type ExternalInboundParticipantIdentity = {
  senderEmails: string[];
  replyToEmails: string[];
  displayNames: string[];
};

/**
 * Extracts conventional mailbox addresses while retaining the matching
 * service's existing normalization behavior. Callers that need a credible
 * external identity should use externalInboundParticipantIdentity, which adds
 * direction, DNS, mailbox, and system-address safeguards.
 */
export function normalizeEmailAddresses(
  value: string | readonly string[] | null | undefined,
): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const addresses = values.flatMap((item) => {
    const bracketed = [...item.matchAll(/<\s*([^<>]+?)\s*>/g)]
      .map((match) => match[1]);
    return bracketed.length ? bracketed : item.split(",");
  });
  return [
    ...new Set(
      addresses
        .map((item) => item.trim().toLowerCase())
        .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)),
    ),
  ];
}

export function normalizeParticipantName(value: string | null | undefined) {
  if (!value) return null;
  const angleAddresses = [...value.matchAll(/<\s*([^<>]+?)\s*>/g)];
  if (angleAddresses.length > 1) return null;
  const display = angleAddresses.length === 1
    ? value.slice(0, angleAddresses[0].index).trim()
    : normalizeEmailAddresses(value).length
      ? ""
      : value.trim();
  const normalized = display
    .replace(/^["']|["']$/g, "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized || null;
}

function hasCredibleDnsDomain(email: string) {
  const separator = email.lastIndexOf("@");
  const localPart = email.slice(0, separator);
  const rawDomain = email.slice(separator + 1);
  if (
    separator <= 0 ||
    localPart.length > 64 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart) ||
    !rawDomain ||
    rawDomain.endsWith(".")
  ) {
    return false;
  }

  const domain = domainToASCII(rawDomain.toLowerCase());
  if (
    !domain ||
    domain.length > 253 ||
    !domain.includes(".") ||
    isIP(domain) !== 0 ||
    NON_PUBLIC_DNS_SUFFIXES.has(domain.slice(domain.lastIndexOf(".") + 1))
  ) {
    return false;
  }
  return domain.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

function isSystemOnlyAddress(email: string) {
  const localPart = email.slice(0, email.lastIndexOf("@")).split("+", 1)[0];
  return SYSTEM_ONLY_LOCAL_PARTS.has(localPart);
}

function credibleExternalAddresses(value: string | null | undefined) {
  return normalizeEmailAddresses(value).filter(
    (email) => hasCredibleDnsDomain(email) && !isSystemOnlyAddress(email),
  );
}

function shouldKeepDisplayName(
  value: string | null | undefined,
  parsedAddresses: string[],
  externalAddresses: string[],
) {
  if (!value) return false;
  if (parsedAddresses.length > 0) return externalAddresses.length > 0;

  // Preserve existing name-only matching, but do not turn malformed address
  // syntax into a participant name.
  return !/[@<>]/.test(value);
}

function boundedLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) {
    return MAX_EXTERNAL_IDENTITY_MESSAGES;
  }
  return Math.max(
    0,
    Math.min(MAX_EXTERNAL_IDENTITY_MESSAGES, Math.trunc(limit)),
  );
}

/**
 * Returns only bounded external identities from inbound sender/reply-to
 * fields. Recipient fields are deliberately ignored: copied recipients are
 * not evidence about the person or company that initiated a conversation.
 */
export function externalInboundParticipantIdentity(
  messages: readonly ParticipantIdentityMessage[],
  excludedAddresses: ExcludedAddresses,
  limit?: number,
): ExternalInboundParticipantIdentity {
  const excludedValues =
    typeof excludedAddresses === "string" || excludedAddresses == null
      ? excludedAddresses
      : excludedAddresses.filter(
        (value): value is string => typeof value === "string",
      );
  const excluded = new Set(normalizeEmailAddresses(excludedValues));
  const senderEmails = new Set<string>();
  const replyToEmails = new Set<string>();
  const displayNames = new Set<string>();
  const take = boundedLimit(limit);
  const boundedMessages = take === 0 ? [] : messages.slice(-take);

  for (const message of boundedMessages) {
    if (message.direction !== "INBOUND") continue;

    for (const value of [message.sender, message.replyTo]) {
      const parsedAddresses = normalizeEmailAddresses(value);
      const externalAddresses = credibleExternalAddresses(value).filter(
        (email) => !excluded.has(email),
      );
      if (
        shouldKeepDisplayName(value, parsedAddresses, externalAddresses)
      ) {
        const displayName = normalizeParticipantName(value);
        if (displayName) displayNames.add(displayName);
      }
    }

    for (const email of credibleExternalAddresses(message.sender)) {
      if (!excluded.has(email)) senderEmails.add(email);
    }
    for (const email of credibleExternalAddresses(message.replyTo)) {
      if (!excluded.has(email)) replyToEmails.add(email);
    }
  }

  return {
    senderEmails: [...senderEmails].sort(),
    replyToEmails: [...replyToEmails].sort(),
    displayNames: [...displayNames].sort(),
  };
}
