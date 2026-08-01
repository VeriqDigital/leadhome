import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { recordOutboundContactActivities } from "@/lib/activity-service";
import { normalizeEmailAddresses } from "./participant-identity";

type OutboundContactClient = Pick<
  Prisma.TransactionClient,
  "conversation" | "lead" | "leadActivity" | "message" | "task"
>;

type ImportedMessage = {
  id: string;
  providerMessageId: string;
  direction: "INBOUND" | "OUTBOUND";
  recipients: readonly string[];
  subject: string | null;
  receivedAt: Date;
};

function activityKey(
  accountId: string,
  providerMessageId: string,
  leadId: string,
) {
  const identity = createHash("sha256")
    .update(`GMAIL\0${accountId}\0${providerMessageId}\0${leadId}`)
    .digest("hex");
  return `gmail-outbound-contact:${identity}`;
}

export async function recordGmailOutboundContactEvidence(
  client: OutboundContactClient,
  {
    ownerId,
    accountId,
    conversationId,
    ownedMailboxAddresses,
    messages,
  }: {
    ownerId: string;
    accountId: string;
    conversationId: string;
    ownedMailboxAddresses: readonly (string | null)[];
    messages: readonly ImportedMessage[];
  },
) {
  const excluded = new Set(normalizeEmailAddresses(
    ownedMailboxAddresses.filter(
      (address): address is string => typeof address === "string",
    ),
  ));
  let created = 0;

  for (const message of messages) {
    if (message.direction !== "OUTBOUND") continue;
    const recipients = normalizeEmailAddresses(message.recipients).filter(
      (address) => !excluded.has(address),
    );
    if (!recipients.length) continue;

    const candidates = await client.lead.findMany({
      where: {
        userId: ownerId,
        email: { in: recipients, mode: "insensitive" },
      },
      select: { id: true, email: true },
    });
    const candidatesByEmail = new Map<string, string[]>();
    for (const candidate of candidates) {
      const email = normalizeEmailAddresses(candidate.email)[0];
      if (!email) continue;
      const ids = candidatesByEmail.get(email) ?? [];
      ids.push(candidate.id);
      candidatesByEmail.set(email, ids);
    }
    const matchedLeadIds = new Set<string>();
    for (const recipient of recipients) {
      const ids = candidatesByEmail.get(recipient) ?? [];
      if (ids.length === 1) matchedLeadIds.add(ids[0]!);
    }
    if (!matchedLeadIds.size) continue;

    // LeadActivity currently permits only one activity of a type per message.
    // Preserve the message relation for the common single-lead case; for a
    // multi-lead send, keep each canonical activity related to the conversation
    // and idempotent by provider message + lead without guessing one winner.
    const canRelateMessage = matchedLeadIds.size === 1;
    const result = await recordOutboundContactActivities(
      client,
      [...matchedLeadIds].map((leadId) => ({
        ownerId,
        leadId,
        conversationId,
        messageId: canRelateMessage ? message.id : null,
        source: "GMAIL" as const,
        title: "Email sent",
        description: message.subject ?? "No subject",
        occurredAt: message.receivedAt,
        idempotencyKey: activityKey(
          accountId,
          message.providerMessageId,
          leadId,
        ),
      })),
    );
    created += result.count;
  }

  return { created };
}
