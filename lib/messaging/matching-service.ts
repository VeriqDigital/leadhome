import "server-only";

import { createHash } from "node:crypto";
import {
  JobType,
  Prisma,
  type ConversationMatchKind,
  type ConversationReviewState,
} from "@prisma/client";
import { hashSecret } from "@/lib/inbound-crypto";
import { prisma } from "@/lib/prisma";
import { recordActivity } from "@/lib/activity-service";
import {
  enqueueConversationAnalysisAfterLeadLink,
} from "@/lib/ai/conversation-analysis/job-service";
import { logJobEvent } from "@/lib/jobs/logging";
import {
  normalizeEmailAddresses,
  normalizeParticipantName,
} from "./participant-identity";
import type { NormalizedMessage } from "./provider";
import { detectCompanyAfterAttachment } from "./company-detection-service";
import {
  enqueueCompanyDetectionJob,
} from "./company-detection-job-service";

export {
  normalizeEmailAddresses,
  normalizeParticipantName,
} from "./participant-identity";

export const MAX_POSSIBLE_MATCHES = 3;
export const MAX_MATCH_QUERY_ROWS = 20;
export const MAX_REEVALUATION_MESSAGES = 100;

export type ConversationCompanyDetectionMode =
  | "INLINE"
  | "ENQUEUE_GMAIL_IMPORT";

export type LeadMatchReasonCode =
  | "EXACT_SUBMISSION_ID"
  | "EXACT_REPLY_TO_EMAIL"
  | "EXACT_SENDER_EMAIL"
  | "MULTIPLE_LEADS_SHARE_EMAIL"
  | "EXACT_PARTICIPANT_NAME";

type LeadNoMatchCode =
  | "ALREADY_ATTACHED"
  | "MANUALLY_DETACHED"
  | "NO_EXTERNAL_IDENTITY"
  | "NO_CREDIBLE_MATCH"
  | "DISMISSED";

export type LeadMatchCandidate = {
  leadId: string;
  name: string;
  email: string | null;
  company: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasonCodes: LeadMatchReasonCode[];
  reasons: string[];
  matchedEvidence: Array<"SUBMISSION_ID" | "EMAIL" | "NAME">;
  rankingInputs: {
    deterministicEvidence: number;
    exactName: number;
    normalizedName: string;
    stableId: string;
  };
  evidenceFingerprint: string;
};

export type LeadMatchResult =
  | {
      kind: "MATCHED";
      automaticMatch: LeadMatchCandidate;
      possibleMatches: [];
      noMatch: null;
      reason: string;
      evidenceFingerprint: string;
    }
  | {
      kind: "AMBIGUOUS";
      automaticMatch: null;
      possibleMatches: LeadMatchCandidate[];
      noMatch: null;
      reason: string;
      evidenceFingerprint: string;
    }
  | {
      kind: "NO_MATCH";
      automaticMatch: null;
      possibleMatches: [];
      noMatch: {
        code: LeadNoMatchCode;
        reason: string;
      };
      reason: string;
      evidenceFingerprint: string;
    };

type MatchMessage = Pick<
  NormalizedMessage,
  "direction" | "sender" | "replyTo" | "externalSubmissionId"
>;

type LeadRow = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
};

type CandidateEvidence = {
  lead: LeadRow;
  submission: boolean;
  exactEmail: boolean;
  replyToEmail: boolean;
  senderEmail: boolean;
  exactName: boolean;
  sharedEmail: boolean;
};

type ConversationIdentity = {
  emails: string[];
  replyToEmails: Set<string>;
  senderEmails: Set<string>;
  displayNames: string[];
  submissionHashes: string[];
  fingerprint: string;
};

const leadSelect = {
  id: true,
  name: true,
  email: true,
  company: true,
} satisfies Prisma.LeadSelect;

function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function conversationIdentity(
  messages: MatchMessage[],
  accountAddress?: string | null,
): ConversationIdentity {
  const accountEmails = new Set(normalizeEmailAddresses(accountAddress));
  const replyToEmails = new Set<string>();
  const senderEmails = new Set<string>();
  const names = new Set<string>();
  const submissionHashes = new Set<string>();

  for (const message of messages.slice(-MAX_REEVALUATION_MESSAGES)) {
    if (message.direction !== "INBOUND") continue;
    for (const email of normalizeEmailAddresses(message.sender)) {
      if (!accountEmails.has(email)) senderEmails.add(email);
    }
    for (const email of normalizeEmailAddresses(message.replyTo)) {
      if (!accountEmails.has(email)) replyToEmails.add(email);
    }
    const senderName = normalizeParticipantName(message.sender);
    const replyToName = normalizeParticipantName(message.replyTo);
    if (senderName) names.add(senderName);
    if (replyToName) names.add(replyToName);
    if (message.externalSubmissionId) {
      submissionHashes.add(hashSecret(message.externalSubmissionId));
    }
  }

  const emails = [...new Set([...replyToEmails, ...senderEmails])].sort();
  const displayNames = [...names].sort();
  const sortedSubmissionHashes = [...submissionHashes].sort();
  return {
    emails,
    replyToEmails,
    senderEmails,
    displayNames,
    submissionHashes: sortedSubmissionHashes,
    fingerprint: fingerprint({
      version: 1,
      emails,
      displayNames,
      submissionHashes: sortedSubmissionHashes,
    }),
  };
}

function emailWhere(emails: string[]): Prisma.LeadWhereInput {
  return {
    OR: emails.map((email) => ({
      email: { equals: email, mode: "insensitive" as const },
    })),
  };
}

function nameWhere(names: string[]): Prisma.LeadWhereInput {
  return {
    OR: names.map((name) => ({
      name: { equals: name, mode: "insensitive" as const },
    })),
  };
}

async function findEvidenceLeads(ownerId: string, identity: ConversationIdentity) {
  const [submissionLeads, emailLeads, nameLeads] = await Promise.all([
    identity.submissionHashes.length
      ? prisma.lead.findMany({
          where: {
            userId: ownerId,
            inboundSubmissions: {
              some: {
                idempotencyHash: { in: identity.submissionHashes },
                source: { userId: ownerId },
              },
            },
          },
          orderBy: { id: "asc" },
          take: MAX_MATCH_QUERY_ROWS,
          select: leadSelect,
        })
      : Promise.resolve([]),
    identity.emails.length
      ? prisma.lead.findMany({
          where: {
            userId: ownerId,
            ...emailWhere(identity.emails),
          },
          orderBy: { id: "asc" },
          take: MAX_MATCH_QUERY_ROWS,
          select: leadSelect,
        })
      : Promise.resolve([]),
    identity.displayNames.length
      ? prisma.lead.findMany({
          where: {
            userId: ownerId,
            ...nameWhere(identity.displayNames),
          },
          orderBy: { id: "asc" },
          take: MAX_MATCH_QUERY_ROWS,
          select: leadSelect,
        })
      : Promise.resolve([]),
  ]);
  return { submissionLeads, emailLeads, nameLeads };
}

export async function findExistingInboundSubmissionMatch({
  ownerId,
  externalSubmissionId,
}: {
  ownerId: string;
  externalSubmissionId: string;
}): Promise<string | null> {
  const leads = await prisma.lead.findMany({
    where: {
      userId: ownerId,
      inboundSubmissions: {
        some: {
          idempotencyHash: hashSecret(externalSubmissionId),
          source: { userId: ownerId },
        },
      },
    },
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  return leads.length === 1 ? leads[0].id : null;
}

function candidateFingerprint(
  identity: ConversationIdentity,
  evidence: CandidateEvidence,
) {
  return fingerprint({
    version: 1,
    conversationEvidence: identity.fingerprint,
    leadId: evidence.lead.id,
    leadName: normalizeParticipantName(evidence.lead.name),
    leadEmail: normalizeEmailAddresses(evidence.lead.email)[0] ?? null,
    evidence: {
      submission: evidence.submission,
      exactEmail: evidence.exactEmail,
      exactName: evidence.exactName,
    },
  });
}

function candidateFromEvidence(
  identity: ConversationIdentity,
  evidence: CandidateEvidence,
  automatic: boolean,
): LeadMatchCandidate {
  const reasonCodes: LeadMatchReasonCode[] = [];
  const reasons: string[] = [];
  const matchedEvidence: LeadMatchCandidate["matchedEvidence"] = [];

  if (evidence.submission) {
    reasonCodes.push("EXACT_SUBMISSION_ID");
    reasons.push("Matches the original website submission");
    matchedEvidence.push("SUBMISSION_ID");
  }
  if (evidence.exactEmail) {
    if (evidence.sharedEmail) {
      reasonCodes.push("MULTIPLE_LEADS_SHARE_EMAIL");
      reasons.push("Multiple leads share this email");
    } else if (evidence.replyToEmail) {
      reasonCodes.push("EXACT_REPLY_TO_EMAIL");
      reasons.push("Exact reply-to email");
    } else {
      reasonCodes.push("EXACT_SENDER_EMAIL");
      reasons.push("Exact sender email");
    }
    matchedEvidence.push("EMAIL");
  }
  if (evidence.exactName) {
    reasonCodes.push("EXACT_PARTICIPANT_NAME");
    reasons.push("Exact participant name");
    matchedEvidence.push("NAME");
  }

  const deterministicEvidence =
    (evidence.submission ? 2 : 0) + (evidence.exactEmail ? 1 : 0);
  return {
    leadId: evidence.lead.id,
    name: evidence.lead.name,
    email: evidence.lead.email,
    company: evidence.lead.company,
    confidence: automatic || (deterministicEvidence > 0 && evidence.exactName)
      ? "HIGH"
      : deterministicEvidence > 0
        ? "MEDIUM"
        : "LOW",
    reasonCodes,
    reasons,
    matchedEvidence,
    rankingInputs: {
      deterministicEvidence,
      exactName: evidence.exactName ? 1 : 0,
      normalizedName:
        normalizeParticipantName(evidence.lead.name) ?? evidence.lead.name.toLowerCase(),
      stableId: evidence.lead.id,
    },
    evidenceFingerprint: candidateFingerprint(identity, evidence),
  };
}

function compareCandidates(left: LeadMatchCandidate, right: LeadMatchCandidate) {
  return (
    right.rankingInputs.deterministicEvidence -
      left.rankingInputs.deterministicEvidence ||
    right.rankingInputs.exactName - left.rankingInputs.exactName ||
    left.rankingInputs.normalizedName.localeCompare(
      right.rankingInputs.normalizedName,
    ) ||
    left.rankingInputs.stableId.localeCompare(right.rankingInputs.stableId)
  );
}

async function removeDismissedCandidates(
  ownerId: string,
  conversationId: string,
  candidates: LeadMatchCandidate[],
) {
  if (!candidates.length) return { visible: candidates, dismissedLeadIds: [] };
  const dismissals = await prisma.conversationLeadMatchDismissal.findMany({
    where: {
      ownerId,
      conversationId,
      leadId: { in: candidates.map((candidate) => candidate.leadId) },
      evidenceFingerprint: {
        in: candidates.map((candidate) => candidate.evidenceFingerprint),
      },
    },
    take: MAX_MATCH_QUERY_ROWS,
    select: { leadId: true, evidenceFingerprint: true },
  });
  const dismissed = new Set(
    dismissals.map(
      (item) => `${item.leadId}:${item.evidenceFingerprint}`,
    ),
  );
  return {
    visible: candidates.filter(
      (candidate) =>
        !dismissed.has(
          `${candidate.leadId}:${candidate.evidenceFingerprint}`,
        ),
    ),
    dismissedLeadIds: candidates
      .filter((candidate) =>
        dismissed.has(
          `${candidate.leadId}:${candidate.evidenceFingerprint}`,
        ))
      .map((candidate) => candidate.leadId),
  };
}

function noMatch(
  identity: ConversationIdentity,
  code: LeadNoMatchCode,
  reason: string,
): LeadMatchResult {
  return {
    kind: "NO_MATCH",
    automaticMatch: null,
    possibleMatches: [],
    noMatch: { code, reason },
    reason,
    evidenceFingerprint: identity.fingerprint,
  };
}

export async function findLeadForConversation({
  ownerId,
  conversation,
  messages,
  accountAddress,
}: {
  ownerId: string;
  conversation: {
    id: string;
    leadId: string | null;
    manuallyDetached: boolean;
  };
  messages: MatchMessage[];
  accountAddress?: string | null;
}): Promise<LeadMatchResult> {
  const identity = conversationIdentity(messages, accountAddress);
  if (conversation.leadId) {
    return noMatch(
      identity,
      "ALREADY_ATTACHED",
      "Conversation is already attached",
    );
  }
  if (conversation.manuallyDetached) {
    return noMatch(
      identity,
      "MANUALLY_DETACHED",
      "Conversation was manually detached",
    );
  }
  if (
    !identity.emails.length &&
    !identity.displayNames.length &&
    !identity.submissionHashes.length
  ) {
    return noMatch(
      identity,
      "NO_EXTERNAL_IDENTITY",
      "No external participant identity was found",
    );
  }

  const { submissionLeads, emailLeads, nameLeads } =
    await findEvidenceLeads(ownerId, identity);
  const submissionIds = new Set(submissionLeads.map((lead) => lead.id));
  const emailIds = new Set(emailLeads.map((lead) => lead.id));
  const nameIds = new Set(nameLeads.map((lead) => lead.id));
  const deterministicIds = new Set([...submissionIds, ...emailIds]);
  const rows = new Map<string, LeadRow>();
  for (const lead of [...submissionLeads, ...emailLeads, ...nameLeads]) {
    rows.set(lead.id, lead);
  }

  const emailCounts = new Map<string, number>();
  for (const lead of emailLeads) {
    const email = normalizeEmailAddresses(lead.email)[0];
    if (email) emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }

  const evidenceFor = (lead: LeadRow): CandidateEvidence => {
    const leadEmail = normalizeEmailAddresses(lead.email)[0];
    const exactEmail = Boolean(leadEmail && identity.emails.includes(leadEmail));
    const normalizedName = normalizeParticipantName(lead.name);
    return {
      lead,
      submission: submissionIds.has(lead.id),
      exactEmail,
      replyToEmail: Boolean(
        leadEmail && identity.replyToEmails.has(leadEmail),
      ),
      senderEmail: Boolean(
        leadEmail && identity.senderEmails.has(leadEmail),
      ),
      exactName: Boolean(
        normalizedName && identity.displayNames.includes(normalizedName),
      ),
      sharedEmail: Boolean(
        leadEmail && (emailCounts.get(leadEmail) ?? 0) > 1,
      ),
    };
  };

  // Automatic attachment remains deliberately narrower than suggestion
  // ranking: it requires one unique exact participant-email candidate and no
  // conflicting submission evidence. A submission identifier can strengthen
  // a suggestion, but never attaches a lead by itself.
  if (emailIds.size === 1 && deterministicIds.size === 1) {
    const lead = rows.get([...deterministicIds][0])!;
    const candidate = candidateFromEvidence(identity, evidenceFor(lead), true);
    const { visible } = await removeDismissedCandidates(
      ownerId,
      conversation.id,
      [candidate],
    );
    if (!visible.length) {
      return noMatch(
        identity,
        "DISMISSED",
        "This match was previously dismissed for the same evidence",
      );
    }
    return {
      kind: "MATCHED",
      automaticMatch: candidate,
      possibleMatches: [],
      noMatch: null,
      reason: candidate.reasons[0] ?? "Deterministic identity match",
      evidenceFingerprint: identity.fingerprint,
    };
  }

  const candidateRows = deterministicIds.size
    ? [...deterministicIds].flatMap((id) => rows.get(id) ?? [])
    : [...nameIds].flatMap((id) => rows.get(id) ?? []);
  const ranked = candidateRows
    .map((lead) => candidateFromEvidence(identity, evidenceFor(lead), false))
    .sort(compareCandidates);
  const { visible, dismissedLeadIds } = await removeDismissedCandidates(
    ownerId,
    conversation.id,
    ranked,
  );
  const possibleMatches = visible.slice(0, MAX_POSSIBLE_MATCHES);
  if (!possibleMatches.length) {
    return noMatch(
      identity,
      dismissedLeadIds.length ? "DISMISSED" : "NO_CREDIBLE_MATCH",
      dismissedLeadIds.length
        ? "Suggested matches were dismissed for the same evidence"
        : "No credible lead match was found",
    );
  }

  const sharedEmail = possibleMatches.some((candidate) =>
    candidate.reasonCodes.includes("MULTIPLE_LEADS_SHARE_EMAIL"));
  const reason = sharedEmail
    ? "Multiple leads share this email"
    : deterministicIds.size > 1
      ? "Conflicting deterministic identity evidence requires review"
      : submissionIds.size
        ? "Website submission identity matched a lead"
      : "Exact participant name";
  return {
    kind: "AMBIGUOUS",
    automaticMatch: null,
    possibleMatches,
    noMatch: null,
    reason,
    evidenceFingerprint: identity.fingerprint,
  };
}

export async function evaluateStoredConversationMatch(
  ownerId: string,
  conversationId: string,
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, ownerId },
    select: {
      id: true,
      leadId: true,
      manuallyDetached: true,
      account: { select: { address: true } },
      messages: {
        where: { direction: "INBOUND" },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: MAX_REEVALUATION_MESSAGES,
        select: {
          direction: true,
          sender: true,
          replyTo: true,
          externalSubmissionId: true,
        },
      },
    },
  });
  if (!conversation) return null;
  return findLeadForConversation({
    ownerId,
    conversation,
    messages: [...conversation.messages].reverse(),
    accountAddress: conversation.account.address,
  });
}

function persistedCandidateIds(value: Prisma.JsonValue | null) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export type PersistedConversationMatchState = {
  id: string;
  leadId: string | null;
  manuallyDetached: boolean;
  reviewState: ConversationReviewState;
  matchKind: ConversationMatchKind | null;
  matchReason: string | null;
  matchCandidateLeadIds: string[];
};

async function readPersistedConversationMatchState(
  ownerId: string,
  conversationId: string,
): Promise<PersistedConversationMatchState> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, ownerId },
    select: {
      id: true,
      leadId: true,
      manuallyDetached: true,
      reviewState: true,
      matchKind: true,
      matchReason: true,
      matchCandidateLeadIds: true,
    },
  });
  if (!conversation) throw new Error("Conversation not found.");
  return {
    ...conversation,
    matchCandidateLeadIds: persistedCandidateIds(
      conversation.matchCandidateLeadIds,
    ),
  };
}

export async function applyConversationLeadMatch({
  ownerId,
  conversationId,
  match,
  companyDetectionMode = "INLINE",
}: {
  ownerId: string;
  conversationId: string;
  match: LeadMatchResult;
  companyDetectionMode?: ConversationCompanyDetectionMode;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.conversation.findFirst({
      where: { id: conversationId, ownerId },
      select: {
        id: true,
        leadId: true,
        subject: true,
        provider: true,
        reviewState: true,
        manuallyDetached: true,
        matchKind: true,
        matchReason: true,
        matchCandidateLeadIds: true,
      },
    });
    if (!current) throw new Error("Conversation not found.");
    if (
      current.leadId ||
      current.manuallyDetached ||
      current.reviewState === "IGNORED" ||
      current.reviewState === "RESOLVED"
    ) {
      return {
        changed: false,
        attached: false,
        matched: Boolean(current.leadId),
        needsReview: current.reviewState === "NEEDS_REVIEW",
      };
    }

    if (match.kind === "MATCHED") {
      const leadId = match.automaticMatch.leadId;
      const ownedLead = await tx.lead.findFirst({
        where: { id: leadId, userId: ownerId },
        select: { id: true },
      });
      if (!ownedLead) throw new Error("Matched lead not found.");
      const attached = await tx.conversation.updateMany({
        where: {
          id: conversationId,
          ownerId,
          leadId: null,
          manuallyDetached: false,
          reviewState: "NEEDS_REVIEW",
        },
        data: {
          leadId,
          reviewState: "MATCHED",
          matchKind: "MATCHED",
          matchReason: match.reason,
          matchCandidateLeadIds: Prisma.JsonNull,
        },
      });
      if (!attached.count) {
        return {
          changed: false,
          attached: false,
          matched: false,
          needsReview: false,
        };
      }
      await recordActivity(tx, {
        ownerId,
        leadId,
        conversationId,
        type: "CONVERSATION_LINKED",
        actorType: "SYSTEM",
        source: current.provider === "GMAIL" ? "GMAIL" : "INBOX",
        title: "Conversation attached",
        description: current.subject ?? "No subject",
        metadata: {
          reasonCodes: match.automaticMatch.reasonCodes,
          automatic: true,
        },
        idempotencyKey: `conversation-auto-link:${conversationId}:${leadId}`,
      });
      await tx.lead.update({
        where: { id: leadId },
        data: { updatedAt: new Date() },
      });
      return {
        changed: true,
        attached: true,
        matched: true,
        needsReview: false,
      };
    }

    const candidateIds = match.kind === "AMBIGUOUS"
      ? match.possibleMatches.map((candidate) => candidate.leadId)
      : [];
    const nextKind = match.kind === "AMBIGUOUS" ? "AMBIGUOUS" : "NO_MATCH";
    const unchanged =
      current.matchKind === nextKind &&
      current.matchReason === match.reason &&
      persistedCandidateIds(current.matchCandidateLeadIds).join("\0") ===
        candidateIds.join("\0");
    if (unchanged) {
      return {
        changed: false,
        attached: false,
        matched: false,
        needsReview: current.reviewState === "NEEDS_REVIEW",
      };
    }
    const updated = await tx.conversation.updateMany({
      where: {
        id: conversationId,
        ownerId,
        leadId: null,
        manuallyDetached: false,
        reviewState: "NEEDS_REVIEW",
      },
      data: {
        matchKind: nextKind,
        matchReason: match.reason,
        matchCandidateLeadIds: candidateIds.length
          ? candidateIds as Prisma.InputJsonValue
          : Prisma.JsonNull,
      },
    });
    return {
      changed: updated.count === 1,
      attached: false,
      matched: false,
      needsReview: true,
    };
  });
  if (result.attached) {
    if (companyDetectionMode === "ENQUEUE_GMAIL_IMPORT") {
      try {
        const enqueued = await enqueueCompanyDetectionJob({
          ownerId,
          conversationId,
        });
        if (enqueued.kind === "not-found") {
          logJobEvent("company_detection_enqueue_failed", {
            jobType: JobType.COMPANY_DETECTION,
            ownerId,
            trigger: "GMAIL_IMPORT",
            failed: 1,
            errorCode: "COMPANY_DETECTION_CONVERSATION_UNAVAILABLE",
          });
        } else {
          logJobEvent("company_detection_queued", {
            jobId: enqueued.job.id,
            jobType: JobType.COMPANY_DETECTION,
            ownerId,
            trigger: "GMAIL_IMPORT",
            queued: enqueued.kind === "queued" ? 1 : 0,
            reused: enqueued.kind === "existing" ? 1 : 0,
            failed: 0,
          });
        }
      } catch {
        logJobEvent("company_detection_enqueue_failed", {
          jobType: JobType.COMPANY_DETECTION,
          ownerId,
          trigger: "GMAIL_IMPORT",
          failed: 1,
          errorCode: "COMPANY_DETECTION_ENQUEUE_FAILED",
        });
      }
    } else {
      await detectCompanyAfterAttachment(ownerId, conversationId);
    }
    await enqueueConversationAnalysisAfterLeadLink(ownerId, conversationId);
  }
  return result;
}

export async function reevaluateConversationLeadMatch(
  ownerId: string,
  conversationId: string,
) {
  const match = await evaluateStoredConversationMatch(ownerId, conversationId);
  if (!match) throw new Error("Conversation not found.");
  const applied = await applyConversationLeadMatch({
    ownerId,
    conversationId,
    match,
  });
  const conversation = await readPersistedConversationMatchState(
    ownerId,
    conversationId,
  );
  return { match, ...applied, conversation };
}

export async function dismissConversationLeadMatch({
  ownerId,
  conversationId,
  leadId,
}: {
  ownerId: string;
  conversationId: string;
  leadId: string;
}) {
  const match = await evaluateStoredConversationMatch(ownerId, conversationId);
  const candidates = match?.kind === "MATCHED"
    ? [match.automaticMatch]
    : match?.kind === "AMBIGUOUS"
      ? match.possibleMatches
      : [];
  const candidate = candidates.find((item) => item.leadId === leadId);
  if (!match || !candidate) {
    throw new Error("Match suggestion is no longer available.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const [conversation, lead] = await Promise.all([
      tx.conversation.findFirst({
        where: {
          id: conversationId,
          ownerId,
          leadId: null,
          manuallyDetached: false,
          reviewState: "NEEDS_REVIEW",
        },
        select: { id: true },
      }),
      tx.lead.findFirst({
        where: { id: leadId, userId: ownerId },
        select: { id: true },
      }),
    ]);
    if (!conversation || !lead) {
      throw new Error("Match suggestion is no longer available.");
    }
    const created = await tx.conversationLeadMatchDismissal.createMany({
      data: [{
        ownerId,
        conversationId,
        leadId,
        evidenceFingerprint: candidate.evidenceFingerprint,
      }],
      skipDuplicates: true,
    });
    const remaining = candidates.filter(
      (item) => item.leadId !== leadId,
    );
    await tx.conversation.updateMany({
      where: {
        id: conversationId,
        ownerId,
        leadId: null,
        manuallyDetached: false,
        reviewState: "NEEDS_REVIEW",
      },
      data: {
        matchKind: remaining.length ? "AMBIGUOUS" : "NO_MATCH",
        matchReason: remaining.length
          ? match.reason
          : "Suggested matches were dismissed for the same evidence",
        matchCandidateLeadIds: remaining.length
          ? remaining.map((item) => item.leadId) as Prisma.InputJsonValue
          : Prisma.JsonNull,
      },
    });
    return { changed: created.count === 1, remaining };
  });
  const conversation = await readPersistedConversationMatchState(
    ownerId,
    conversationId,
  );
  return { ...result, conversation };
}

export async function allowConversationMatchingAgain(
  ownerId: string,
  conversationId: string,
) {
  const preparation = await prisma.$transaction(async (tx) => {
    const current = await tx.conversation.findFirst({
      where: { id: conversationId, ownerId },
      select: { id: true, leadId: true, manuallyDetached: true },
    });
    if (!current) throw new Error("Conversation not found.");
    if (current.leadId) {
      return { suppressionCleared: false, alreadyAttached: true };
    }
    if (!current.manuallyDetached) {
      return { suppressionCleared: false, alreadyAttached: false };
    }

    const cleared = await tx.conversation.updateMany({
      where: {
        id: conversationId,
        ownerId,
        leadId: null,
        manuallyDetached: true,
      },
      data: {
        manuallyDetached: false,
        reviewState: "NEEDS_REVIEW",
        matchKind: null,
        matchReason: null,
        matchCandidateLeadIds: Prisma.JsonNull,
      },
    });
    if (cleared.count === 1) {
      return { suppressionCleared: true, alreadyAttached: false };
    }

    const canonical = await tx.conversation.findFirst({
      where: { id: conversationId, ownerId },
      select: { leadId: true, manuallyDetached: true },
    });
    if (!canonical) throw new Error("Conversation not found.");
    if (canonical.leadId) {
      return { suppressionCleared: false, alreadyAttached: true };
    }
    if (canonical.manuallyDetached) {
      throw new Error("Manual detach could not be cleared.");
    }
    return { suppressionCleared: false, alreadyAttached: false };
  });

  if (preparation.alreadyAttached) {
    return {
      ...preparation,
      changed: false,
      attached: false,
      matched: true,
      needsReview: false,
      match: null,
      conversation: await readPersistedConversationMatchState(
        ownerId,
        conversationId,
      ),
    };
  }

  const reevaluated = await reevaluateConversationLeadMatch(
    ownerId,
    conversationId,
  );
  return {
    ...reevaluated,
    suppressionCleared: preparation.suppressionCleared,
    alreadyAttached: Boolean(
      reevaluated.conversation.leadId && !reevaluated.attached,
    ),
  };
}
