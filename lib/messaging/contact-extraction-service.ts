import "server-only";

import { createHash } from "node:crypto";
import {
  ContactSuggestionField,
  JobStatus,
  JobType,
  Prisma,
  type LeadSource,
  type LeadStatus,
  type MessageDirection,
} from "@prisma/client";
import { getConversationAnalysisConfig } from "@/lib/ai/config";
import { conversationAnalysisOutputSchema } from "@/lib/ai/conversation-analysis/schema";
import { recordActivity } from "@/lib/activity-service";
import { buildLeadUpdateActivities } from "@/lib/lead-activities";
import { prisma } from "@/lib/prisma";
import {
  externalInboundParticipantIdentity,
  normalizeEmailAddresses,
  normalizeParticipantName,
} from "./participant-identity";

const MAX_CONTACT_MESSAGES = 100;
const MAX_OWNER_MAILBOX_ADDRESSES = 20;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export type ContactField = "name" | "email" | "phone";
export type ContactSuggestionSource =
  | "external_sender"
  | "conversation_analysis";
export type ContactSuggestionReasonCode =
  | "EXTERNAL_SENDER_EMAIL"
  | "EXTERNAL_SENDER_NAME"
  | "ANALYSIS_CONTACT_NAME"
  | "ANALYSIS_CONTACT_EMAIL"
  | "ANALYSIS_CONTACT_PHONE";

export type ConversationContactSuggestion = {
  field: ContactField;
  candidateValue: string;
  currentValue: string | null;
  source: ContactSuggestionSource;
  reasonCode: ContactSuggestionReasonCode;
  explanation: string;
  evidenceFingerprint: string;
  reviewFingerprint: string;
  conflict: boolean;
};

export type ConversationContactExtractionView = {
  conversationId: string;
  lead: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  state:
    | "NOT_APPLICABLE"
    | "REFRESHING"
    | "READY"
    | "PARTIAL"
    | "AMBIGUOUS"
    | "NO_SUGGESTIONS";
  suggestions: ConversationContactSuggestion[];
  ambiguous: boolean;
  ambiguousFields: ContactField[];
  refreshing: boolean;
  reviewFingerprint: string | null;
  canRecheck: boolean;
  evaluatedAt: string;
};

export type ContactExtractionMutation = {
  changed: boolean;
  outcome:
    | "APPLIED"
    | "DISMISSED"
    | "NO_CHANGE"
    | "STALE"
    | "NOT_APPLICABLE"
    | "PARTIAL";
  contactView: ConversationContactExtractionView;
  appliedFields: ContactField[];
  skippedFields: ContactField[];
};

type ContactClient = Pick<
  Prisma.TransactionClient,
  | "conversation"
  | "conversationContactSuggestionDismissal"
  | "lead"
  | "leadActivity"
  | "message"
  | "job"
  | "task"
>;

type TrackedLead = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: LeadSource;
  status: LeadStatus;
  message: string | null;
  estimatedValue: Prisma.Decimal | null;
  nextFollowUpDate: Date | null;
  updatedAt: Date;
};

type BaseCandidate = {
  field: ContactField;
  candidateValue: string;
  normalizedValue: string;
  source: ContactSuggestionSource;
  reasonCode: ContactSuggestionReasonCode;
  explanation: string;
  evidenceFingerprint: string;
  candidateHash: string;
};

type EvaluatedCandidate = BaseCandidate & {
  currentValue: string | null;
  currentNormalizedValue: string | null;
  reviewFingerprint: string;
  conflict: boolean;
  equal: boolean;
  dismissed: boolean;
  reviewContextFingerprint: string;
};

type InternalEvaluation = {
  view: ConversationContactExtractionView;
  lead: TrackedLead | null;
  candidates: EvaluatedCandidate[];
};

type CandidateResolution = {
  candidates: BaseCandidate[];
  ambiguousFields: ContactField[];
};

const trackedLeadSelect = {
  id: true,
  userId: true,
  name: true,
  email: true,
  phone: true,
  company: true,
  source: true,
  status: true,
  message: true,
  estimatedValue: true,
  nextFollowUpDate: true,
  updatedAt: true,
} satisfies Prisma.LeadSelect;

const persistenceField: Record<ContactField, ContactSuggestionField> = {
  name: ContactSuggestionField.NAME,
  email: ContactSuggestionField.EMAIL,
  phone: ContactSuggestionField.PHONE,
};

const fieldOrder: ContactField[] = ["name", "email", "phone"];

function isContactField(value: unknown): value is ContactField {
  return value === "name" || value === "email" || value === "phone";
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function compactText(value: string | null | undefined, maximum: number) {
  if (!value) return null;
  const compact = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return compact && compact.length <= maximum ? compact : null;
}

const GENERIC_NAME_PATTERN =
  /\b(?:support|sales|info|billing|notifications?|no[\s-]?reply|noreply|customer\s+service|account\s+verification|team|admins?|administrator)\b/i;

function validContactName(value: string | null | undefined) {
  const display = compactText(value, 120);
  if (!display || /[@<>]/.test(display)) return null;
  const normalized = normalizeParticipantName(display);
  if (!normalized || GENERIC_NAME_PATTERN.test(normalized)) return null;
  return { display, normalized };
}

function readableSenderName(value: string | null | undefined) {
  if (!value) return null;
  const angleMatches = [...value.matchAll(/<\s*([^<>]+?)\s*>/g)];
  if (angleMatches.length > 1) return null;
  const parsedAddresses = normalizeEmailAddresses(value);
  const rawDisplay = angleMatches.length === 1
    ? value.slice(0, angleMatches[0].index).trim()
    : parsedAddresses.length
      ? ""
      : value.trim();
  const display = rawDisplay.replace(/^["']|["']$/g, "");
  return validContactName(display);
}

function validExternalEmail(
  value: string | null | undefined,
  excludedAddresses: readonly (string | null | undefined)[],
) {
  if (!value) return null;
  const identity = externalInboundParticipantIdentity(
    [{ direction: "INBOUND", sender: value, replyTo: null }],
    excludedAddresses,
    1,
  );
  if (identity.senderEmails.length !== 1) return null;
  const normalized = identity.senderEmails[0];
  return { display: normalized, normalized };
}

function validPhone(value: string | null | undefined) {
  const display = compactText(value, 40);
  if (!display || !/^\+?[\d\s().-]+$/.test(display)) return null;
  const digits = display.replace(/\D/g, "");
  const openParentheses = [...display].filter((character) => character === "(").length;
  const closeParentheses = [...display].filter((character) => character === ")").length;
  if (
    digits.length < 7 ||
    digits.length > 15 ||
    /^(\d)\1+$/.test(digits) ||
    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(display) ||
    openParentheses !== closeParentheses ||
    openParentheses > 1 ||
    (openParentheses === 1 && display.indexOf("(") > display.indexOf(")"))
  ) {
    return null;
  }
  return {
    display,
    normalized: `${display.startsWith("+") ? "+" : ""}${digits}`,
  };
}

function normalizedCurrentValue(field: ContactField, value: string | null) {
  const compact = compactText(value, 1_000);
  if (!compact) return null;
  if (field === "name") {
    return normalizeParticipantName(compact) ?? compact.toLocaleLowerCase("en");
  }
  if (field === "email") {
    const addresses = normalizeEmailAddresses(compact);
    return addresses.length === 1
      ? addresses[0]
      : compact.toLocaleLowerCase("en");
  }
  return validPhone(compact)?.normalized ?? compact.toLocaleLowerCase("en");
}

function evidenceFingerprint(
  candidate: Omit<BaseCandidate, "evidenceFingerprint" | "candidateHash">,
  evidence: Record<string, unknown>,
) {
  return fingerprint({
    version: 1,
    field: candidate.field,
    source: candidate.source,
    normalizedValue: candidate.normalizedValue,
    ...evidence,
  });
}

function completeCandidate(
  candidate: Omit<BaseCandidate, "evidenceFingerprint" | "candidateHash">,
  evidence: Record<string, unknown>,
): BaseCandidate {
  return {
    ...candidate,
    candidateHash: fingerprint({
      version: 1,
      field: candidate.field,
      normalizedValue: candidate.normalizedValue,
    }),
    evidenceFingerprint: evidenceFingerprint(candidate, evidence),
  };
}

function candidateReviewFingerprint(
  candidate: BaseCandidate,
  currentNormalizedValue: string | null,
  conflict: boolean,
  reviewContextFingerprint: string,
) {
  return fingerprint({
    version: 2,
    field: candidate.field,
    evidenceFingerprint: candidate.evidenceFingerprint,
    currentNormalizedValue,
    conflict,
    reviewContextFingerprint,
  });
}

function publicLead(lead: TrackedLead | null) {
  return lead
    ? {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
      }
    : null;
}

function publicSuggestion(
  candidate: EvaluatedCandidate,
): ConversationContactSuggestion {
  return {
    field: candidate.field,
    candidateValue: candidate.candidateValue,
    currentValue: candidate.currentValue,
    source: candidate.source,
    reasonCode: candidate.reasonCode,
    explanation: candidate.explanation,
    evidenceFingerprint: candidate.evidenceFingerprint,
    reviewFingerprint: candidate.reviewFingerprint,
    conflict: candidate.conflict,
  };
}

function viewFor({
  conversationId,
  lead,
  candidates,
  ambiguousFields,
  refreshing,
}: {
  conversationId: string;
  lead: TrackedLead | null;
  candidates: EvaluatedCandidate[];
  ambiguousFields: ContactField[];
  refreshing: boolean;
}): ConversationContactExtractionView {
  if (!lead) {
    return {
      conversationId,
      lead: null,
      state: "NOT_APPLICABLE",
      suggestions: [],
      ambiguous: false,
      ambiguousFields: [],
      refreshing: false,
      reviewFingerprint: null,
      canRecheck: false,
      evaluatedAt: new Date(0).toISOString(),
    };
  }
  const visible = candidates.filter(
    (candidate) => !candidate.equal && !candidate.dismissed,
  );
  const suggestions = visible.map(publicSuggestion);
  const ambiguous = ambiguousFields.length > 0;
  return {
    conversationId,
    lead: publicLead(lead),
    state: refreshing
      ? "REFRESHING"
      : suggestions.length
        ? ambiguous
          ? "PARTIAL"
          : "READY"
        : ambiguous
          ? "AMBIGUOUS"
          : "NO_SUGGESTIONS",
    suggestions,
    ambiguous,
    ambiguousFields,
    refreshing,
    reviewFingerprint: suggestions.length && !refreshing
      ? fingerprint({
          version: 1,
          suggestions: suggestions.map((suggestion) =>
            suggestion.reviewFingerprint),
        })
      : null,
    canRecheck: true,
    evaluatedAt: lead.updatedAt.toISOString(),
  };
}

function deterministicCandidates({
  messages,
  excludedAddresses,
}: {
  messages: Array<{
    direction: MessageDirection;
    sender: string;
    receivedAt: Date;
    createdAt: Date;
  }>;
  excludedAddresses: readonly (string | null | undefined)[];
}) {
  const chronological = [...messages].reverse();
  const senderOnly = chronological.map((message) => ({
    direction: message.direction,
    sender: message.sender,
    replyTo: null,
  }));
  const identity = externalInboundParticipantIdentity(
    senderOnly,
    excludedAddresses,
    MAX_CONTACT_MESSAGES,
  );
  const correlatedNames = new Map<string, string>();
  const nameOnlySenders = new Map<string, string>();
  const email = identity.senderEmails.length === 1
    ? identity.senderEmails[0]
    : undefined;
  for (const message of messages) {
    if (message.direction !== "INBOUND") continue;
    const messageIdentity = externalInboundParticipantIdentity(
      [{ direction: message.direction, sender: message.sender, replyTo: null }],
      excludedAddresses,
      1,
    );
    const name = readableSenderName(message.sender);
    if (!name || !messageIdentity.displayNames.includes(name.normalized)) {
      continue;
    }
    if (messageIdentity.senderEmails.length === 0) {
      if (!nameOnlySenders.has(name.normalized)) {
        nameOnlySenders.set(name.normalized, name.display);
      }
    } else if (
      email &&
      messageIdentity.senderEmails.length === 1 &&
      messageIdentity.senderEmails[0] === email &&
      !correlatedNames.has(name.normalized)
    ) {
      correlatedNames.set(name.normalized, name.display);
    }
  }

  const readableNames = email ? correlatedNames : nameOnlySenders;
  const ambiguousFields = new Set<ContactField>();
  if (identity.senderEmails.length > 1) {
    ambiguousFields.add("email");
    ambiguousFields.add("name");
  }
  if (readableNames.size > 1 || Boolean(email && nameOnlySenders.size)) {
    ambiguousFields.add("name");
  }

  const candidates: BaseCandidate[] = [];
  if (email && !ambiguousFields.has("email")) {
    candidates.push(completeCandidate({
      field: "email",
      candidateValue: email,
      normalizedValue: email,
      source: "external_sender",
      reasonCode: "EXTERNAL_SENDER_EMAIL",
      explanation: "External sender address",
    }, { identity: email }));
  }
  const nameEntry = [...readableNames.entries()][0];
  if (nameEntry && !ambiguousFields.has("name")) {
    candidates.push(completeCandidate({
      field: "name",
      candidateValue: nameEntry[1],
      normalizedValue: nameEntry[0],
      source: "external_sender",
      reasonCode: "EXTERNAL_SENDER_NAME",
      explanation: "External sender name",
    }, {
      identity: email ?? nameEntry[0],
    }));
  }
  return { candidates, ambiguousFields: [...ambiguousFields] };
}

function analysisCandidates({
  analysis,
  enabled,
  currentMessageCount,
  newestMessageCreatedAt,
  excludedAddresses,
}: {
  analysis: {
    status: string;
    contentHash: string | null;
    analysisVersion: string;
    structuredData: Prisma.JsonValue | null;
    sourceMessageCount: number;
    completedAt: Date | null;
  } | null;
  enabled: boolean;
  currentMessageCount: number;
  newestMessageCreatedAt: Date | null;
  excludedAddresses: readonly (string | null | undefined)[];
}) {
  const currentVersion = getConversationAnalysisConfig().analysisVersion;
  if (
    !enabled ||
    !analysis ||
    analysis.status !== "COMPLETED" ||
    !analysis.contentHash ||
    !analysis.completedAt ||
    !analysis.structuredData ||
    analysis.analysisVersion !== currentVersion ||
    analysis.sourceMessageCount !== currentMessageCount ||
    (newestMessageCreatedAt && newestMessageCreatedAt > analysis.completedAt)
  ) {
    return [] as BaseCandidate[];
  }
  const parsed = conversationAnalysisOutputSchema.safeParse(
    analysis.structuredData,
  );
  if (!parsed.success) return [];
  const contact = parsed.data.contact;
  const ordinals = [...new Set(contact.evidenceMessageOrdinals)].sort(
    (left, right) => left - right,
  );
  if (!ordinals.length) return [];

  const values: Array<{
    field: ContactField;
    value: { display: string; normalized: string } | null;
    reasonCode: ContactSuggestionReasonCode;
  }> = [
    {
      field: "name",
      value: validContactName(contact.name),
      reasonCode: "ANALYSIS_CONTACT_NAME",
    },
    {
      field: "email",
      value: validExternalEmail(contact.email, excludedAddresses),
      reasonCode: "ANALYSIS_CONTACT_EMAIL",
    },
    {
      field: "phone",
      value: validPhone(contact.phone),
      reasonCode: "ANALYSIS_CONTACT_PHONE",
    },
  ];
  return values.flatMap(({ field, value, reasonCode }) =>
    value
      ? [completeCandidate({
          field,
          candidateValue: value.display,
          normalizedValue: value.normalized,
          source: "conversation_analysis",
          reasonCode,
          explanation: "Conversation analysis",
        }, {
          analysisVersion: analysis.analysisVersion,
          evidenceMessageOrdinals: ordinals,
        })]
      : []);
}

function resolveCandidates(
  candidates: BaseCandidate[],
  initiallyAmbiguous: readonly ContactField[] = [],
): CandidateResolution {
  const resolved: BaseCandidate[] = [];
  const ambiguousFields = new Set(initiallyAmbiguous);
  for (const field of fieldOrder) {
    if (ambiguousFields.has(field)) continue;
    const values = candidates.filter((candidate) => candidate.field === field);
    const normalized = new Set(values.map((candidate) => candidate.normalizedValue));
    if (normalized.size > 1) {
      ambiguousFields.add(field);
      continue;
    }
    const preferred = values.find(
      (candidate) => candidate.source === "external_sender",
    ) ?? values[0];
    if (preferred) resolved.push(preferred);
  }
  return { candidates: resolved, ambiguousFields: [...ambiguousFields] };
}

async function evaluateWithClient(
  client: ContactClient,
  ownerId: string,
  conversationId: string,
): Promise<InternalEvaluation> {
  const conversation = await client.conversation.findFirst({
    where: { id: conversationId, ownerId },
    select: {
      id: true,
      owner: {
        select: {
          email: true,
          conversationIntelligenceEnabled: true,
          communicationAccounts: {
            where: { address: { not: null } },
            orderBy: { id: "asc" },
            take: MAX_OWNER_MAILBOX_ADDRESSES + 1,
            select: { address: true },
          },
        },
      },
      account: { select: { address: true } },
      lead: { select: trackedLeadSelect },
      analysis: {
        select: {
          latestJobId: true,
          status: true,
          contentHash: true,
          analysisVersion: true,
          structuredData: true,
          sourceMessageCount: true,
          completedAt: true,
        },
      },
      _count: { select: { messages: true } },
      messages: {
        where: { direction: "INBOUND" },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: MAX_CONTACT_MESSAGES,
        select: {
          direction: true,
          sender: true,
          receivedAt: true,
          createdAt: true,
        },
      },
    },
  });
  const lead = conversation?.lead ?? null;
  if (!conversation || !lead || lead.userId !== ownerId) {
    return {
      lead: null,
      candidates: [],
      view: viewFor({
        conversationId,
        lead: null,
        candidates: [],
        ambiguousFields: [],
        refreshing: false,
      }),
    };
  }

  const ownerAccounts = conversation.owner.communicationAccounts;
  const initiallyAmbiguous = new Set<ContactField>();
  if (ownerAccounts.length > MAX_OWNER_MAILBOX_ADDRESSES) {
    initiallyAmbiguous.add("name");
    initiallyAmbiguous.add("email");
  }
  if (conversation.messages.length === MAX_CONTACT_MESSAGES) {
    const overflowMessage = await client.message.findFirst({
      where: {
        conversationId,
        direction: "INBOUND",
        conversation: { ownerId },
      },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      skip: MAX_CONTACT_MESSAGES,
      select: { id: true },
    });
    if (overflowMessage) {
      initiallyAmbiguous.add("name");
      initiallyAmbiguous.add("email");
    }
  }
  const excludedAddresses = [
    conversation.owner.email,
    conversation.account.address,
    ...ownerAccounts.map((account) => account.address),
  ];
  const deterministic = deterministicCandidates({
    messages: conversation.messages,
    excludedAddresses,
  });
  for (const field of deterministic.ambiguousFields) {
    initiallyAmbiguous.add(field);
  }

  const latestJob = conversation.analysis?.latestJobId
    ? await client.job.findFirst({
        where: {
          id: conversation.analysis.latestJobId,
          ownerId,
          type: JobType.CONVERSATION_ANALYSIS,
        },
        select: { status: true },
      })
    : null;
  const refreshing =
    conversation.analysis?.status === "QUEUED" ||
    conversation.analysis?.status === "RUNNING" ||
    latestJob?.status === JobStatus.PENDING ||
    latestJob?.status === JobStatus.RUNNING ||
    latestJob?.status === JobStatus.RETRY_SCHEDULED;
  const reviewContextFingerprint = fingerprint({
    version: 1,
    analysisStatus: conversation.analysis?.status ?? null,
    latestJobId: conversation.analysis?.latestJobId ?? null,
    latestJobStatus: latestJob?.status ?? null,
    contentHash: conversation.analysis?.contentHash ?? null,
    analysisVersion: conversation.analysis?.analysisVersion ?? null,
    completedAt: conversation.analysis?.completedAt?.toISOString() ?? null,
    refreshing,
  });

  const hasInboundMessage = conversation.messages.some(
    (message) => message.direction === "INBOUND",
  );
  const structured = hasInboundMessage && !refreshing
    ? analysisCandidates({
        analysis: conversation.analysis,
        enabled: conversation.owner.conversationIntelligenceEnabled,
        currentMessageCount: conversation._count.messages,
        newestMessageCreatedAt: conversation.messages[0]?.createdAt ?? null,
        excludedAddresses,
      })
    : [];
  // A sender email is independently established by the unique external
  // address. A sender display name is provisional while body/signature
  // identity analysis is still active, so do not present it as settled.
  const deterministicWhileCurrent = refreshing
    ? deterministic.candidates.filter((candidate) => candidate.field === "email")
    : deterministic.candidates;
  const resolved = resolveCandidates(
    [...deterministicWhileCurrent, ...structured],
    [...initiallyAmbiguous],
  );

  const preliminarilyEvaluated = resolved.candidates.map((candidate) => {
    const currentValue = lead[candidate.field];
    const currentNormalizedValue = normalizedCurrentValue(
      candidate.field,
      currentValue,
    );
    const equal = currentNormalizedValue === candidate.normalizedValue;
    const conflict = Boolean(currentValue?.trim()) && !equal;
    return {
      ...candidate,
      currentValue,
      currentNormalizedValue,
      equal,
      conflict,
      reviewFingerprint: candidateReviewFingerprint(
        candidate,
        currentNormalizedValue,
        conflict,
        reviewContextFingerprint,
      ),
      dismissed: false,
      reviewContextFingerprint,
    } satisfies EvaluatedCandidate;
  });
  const dismissals = preliminarilyEvaluated.length
    ? await client.conversationContactSuggestionDismissal.findMany({
        where: {
          ownerId,
          conversationId,
          leadId: lead.id,
          OR: preliminarilyEvaluated.map((candidate) => ({
            field: persistenceField[candidate.field],
            candidateHash: candidate.candidateHash,
            evidenceFingerprint: candidate.evidenceFingerprint,
          })),
        },
        take: preliminarilyEvaluated.length,
        select: {
          field: true,
          candidateHash: true,
          evidenceFingerprint: true,
        },
      })
    : [];
  const dismissedKeys = new Set(dismissals.map((dismissal) =>
    `${dismissal.field}:${dismissal.candidateHash}:${dismissal.evidenceFingerprint}`));
  const candidates = preliminarilyEvaluated.map((candidate) => ({
    ...candidate,
    dismissed: dismissedKeys.has(
      `${persistenceField[candidate.field]}:${candidate.candidateHash}:${candidate.evidenceFingerprint}`,
    ),
  }));
  return {
    lead,
    candidates,
    view: viewFor({
      conversationId,
      lead,
      candidates,
      ambiguousFields: resolved.ambiguousFields,
      refreshing,
    }),
  };
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function serializable<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (attempt === 2 || !isRetryableTransactionError(error)) throw error;
    }
  }
  throw new Error("Contact extraction transaction did not complete.");
}

function mutation(
  outcome: ContactExtractionMutation["outcome"],
  contactView: ConversationContactExtractionView,
  options: {
    changed?: boolean;
    appliedFields?: ContactField[];
    skippedFields?: ContactField[];
  } = {},
): ContactExtractionMutation {
  return {
    changed: options.changed ?? false,
    outcome,
    contactView,
    appliedFields: options.appliedFields ?? [],
    skippedFields: options.skippedFields ?? [],
  };
}

async function canonicalAfter(
  client: ContactClient,
  ownerId: string,
  conversationId: string,
) {
  return (await evaluateWithClient(client, ownerId, conversationId)).view;
}

function derivedViewAfterMutation(
  current: InternalEvaluation,
  {
    lead = current.lead,
    dismissed = [],
  }: {
    lead?: TrackedLead | null;
    dismissed?: EvaluatedCandidate[];
  } = {},
) {
  const dismissedKeys = new Set(dismissed.map((candidate) =>
    `${candidate.field}:${candidate.candidateHash}:${candidate.evidenceFingerprint}`));
  const candidates = current.candidates.map((candidate) => {
    const currentValue = lead?.[candidate.field] ?? null;
    const currentNormalizedValue = normalizedCurrentValue(
      candidate.field,
      currentValue,
    );
    const equal = currentNormalizedValue === candidate.normalizedValue;
    const conflict = Boolean(currentValue?.trim()) && !equal;
    return {
      ...candidate,
      currentValue,
      currentNormalizedValue,
      equal,
      conflict,
      reviewFingerprint: candidateReviewFingerprint(
        candidate,
        currentNormalizedValue,
        conflict,
        candidate.reviewContextFingerprint,
      ),
      dismissed:
        candidate.dismissed ||
        dismissedKeys.has(
          `${candidate.field}:${candidate.candidateHash}:${candidate.evidenceFingerprint}`,
        ),
    } satisfies EvaluatedCandidate;
  });
  return viewFor({
    conversationId: current.view.conversationId,
    lead,
    candidates,
    ambiguousFields: current.view.ambiguousFields,
    refreshing: current.view.refreshing,
  });
}

async function recordContactChange(
  tx: Prisma.TransactionClient,
  {
    ownerId,
    conversationId,
    previous,
    next,
    evidenceFingerprints,
  }: {
    ownerId: string;
    conversationId: string;
    previous: TrackedLead;
    next: TrackedLead;
    evidenceFingerprints: string[];
  },
) {
  const activity = buildLeadUpdateActivities(previous, next).find(
    (item) => item.type === "CONTACT_INFO_CHANGED",
  );
  if (!activity) throw new Error("Contact activity was not generated.");
  await recordActivity(tx, {
    ...activity,
    ownerId,
    leadId: previous.id,
    conversationId,
    actorType: "USER",
    source: "INBOX",
    idempotencyKey:
      `contact-extraction:${conversationId}:${previous.id}:` +
      fingerprint({
        version: 1,
        previousUpdatedAt: previous.updatedAt.toISOString(),
        evidenceFingerprints: [...evidenceFingerprints].sort(),
      }),
  });
}

export async function getConversationContactExtractionView(
  ownerId: string,
  conversationId: string,
) {
  return (
    await evaluateWithClient(
      prisma as unknown as ContactClient,
      ownerId,
      conversationId,
    )
  ).view;
}

export async function applyConversationContactSuggestion(input: {
  ownerId: string;
  conversationId: string;
  expectedLeadId: string;
  field: ContactField;
  evidenceFingerprint: string;
  reviewFingerprint: string;
  replace: boolean;
}): Promise<ContactExtractionMutation> {
  return serializable(async (tx) => {
    const current = await evaluateWithClient(
      tx,
      input.ownerId,
      input.conversationId,
    );
    if (!current.lead) {
      return mutation("NOT_APPLICABLE", current.view);
    }
    if (current.view.refreshing) {
      return mutation("STALE", current.view, {
        skippedFields: [input.field],
      });
    }
    if (
      current.lead.id !== input.expectedLeadId ||
      !isContactField(input.field) ||
      !FINGERPRINT_PATTERN.test(input.evidenceFingerprint) ||
      !FINGERPRINT_PATTERN.test(input.reviewFingerprint)
    ) {
      return mutation("STALE", current.view);
    }
    const candidate = current.candidates.find(
      (item) =>
        item.field === input.field &&
        item.evidenceFingerprint === input.evidenceFingerprint,
    );
    if (!candidate) return mutation("STALE", current.view);
    if (candidate.equal) {
      return !input.replace &&
        input.reviewFingerprint === priorBlankReviewFingerprint(candidate)
        ? mutation("NO_CHANGE", current.view)
        : mutation("STALE", current.view);
    }
    if (
      candidate.dismissed ||
      candidate.reviewFingerprint !== input.reviewFingerprint ||
      candidate.conflict !== input.replace
    ) {
      return mutation("STALE", current.view, {
        skippedFields: [candidate.field],
      });
    }

    const where: Prisma.LeadWhereInput = {
      id: current.lead.id,
      userId: input.ownerId,
      updatedAt: current.lead.updatedAt,
      conversations: {
        some: {
          id: input.conversationId,
          ownerId: input.ownerId,
          leadId: current.lead.id,
        },
      },
      [candidate.field]: candidate.currentValue,
    };
    const updatedAt = nextLeadUpdatedAt(current.lead.updatedAt);
    const updated = await tx.lead.updateMany({
      where,
      data: {
        [candidate.field]: candidate.candidateValue,
        updatedAt,
      },
    });
    if (updated.count !== 1) {
      return mutation(
        "STALE",
        await canonicalAfter(tx, input.ownerId, input.conversationId),
        { skippedFields: [candidate.field] },
      );
    }
    const next: TrackedLead = {
      ...current.lead,
      [candidate.field]: candidate.candidateValue,
      updatedAt,
    };
    await recordContactChange(tx, {
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      previous: current.lead,
      next,
      evidenceFingerprints: [candidate.evidenceFingerprint],
    });
    return mutation(
      "APPLIED",
      derivedViewAfterMutation(current, { lead: next }),
      { changed: true, appliedFields: [candidate.field] },
    );
  });
}

function normalizedReviewFingerprints(values: readonly string[]) {
  if (
    values.length < 1 ||
    values.length > 3 ||
    values.some((value) => !FINGERPRINT_PATTERN.test(value)) ||
    new Set(values).size !== values.length
  ) {
    return null;
  }
  return new Set(values);
}

function priorBlankReviewFingerprint(candidate: EvaluatedCandidate) {
  return candidateReviewFingerprint(
    candidate,
    null,
    false,
    candidate.reviewContextFingerprint,
  );
}

function nextLeadUpdatedAt(previous: Date) {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

export async function applyAvailableConversationContactSuggestions(input: {
  ownerId: string;
  conversationId: string;
  expectedLeadId: string;
  reviewFingerprints: string[];
}): Promise<ContactExtractionMutation> {
  return serializable(async (tx) => {
    const current = await evaluateWithClient(
      tx,
      input.ownerId,
      input.conversationId,
    );
    if (!current.lead) {
      return mutation("NOT_APPLICABLE", current.view);
    }
    if (current.view.refreshing) {
      return mutation("STALE", current.view);
    }
    const expected = normalizedReviewFingerprints(input.reviewFingerprints);
    if (current.lead.id !== input.expectedLeadId || !expected) {
      return mutation("STALE", current.view);
    }

    const selected: EvaluatedCandidate[] = [];
    const skipped = new Set<ContactField>();
    let matchedTokens = 0;
    const alreadySatisfied = new Set<ContactField>();
    for (const candidate of current.candidates) {
      if (expected.has(candidate.reviewFingerprint)) {
        matchedTokens += 1;
        if (!candidate.equal && !candidate.dismissed && !candidate.conflict) {
          selected.push(candidate);
        } else {
          skipped.add(candidate.field);
        }
        continue;
      }
      if (expected.has(priorBlankReviewFingerprint(candidate))) {
        matchedTokens += 1;
        if (candidate.equal) alreadySatisfied.add(candidate.field);
        else skipped.add(candidate.field);
      }
    }
    const unknownTokenCount = expected.size - matchedTokens;
    if (!selected.length) {
      if (unknownTokenCount || skipped.size) {
        return mutation("PARTIAL", current.view, {
          skippedFields: [...skipped],
        });
      }
      return mutation(
        alreadySatisfied.size ? "NO_CHANGE" : "STALE",
        current.view,
      );
    }

    const where: Prisma.LeadWhereInput = {
      id: current.lead.id,
      userId: input.ownerId,
      updatedAt: current.lead.updatedAt,
      conversations: {
        some: {
          id: input.conversationId,
          ownerId: input.ownerId,
          leadId: current.lead.id,
        },
      },
    };
    const updatedAt = nextLeadUpdatedAt(current.lead.updatedAt);
    const data: Prisma.LeadUpdateManyMutationInput = { updatedAt };
    for (const candidate of selected) {
      Object.assign(where, { [candidate.field]: candidate.currentValue });
      Object.assign(data, { [candidate.field]: candidate.candidateValue });
    }
    const updated = await tx.lead.updateMany({ where, data });
    if (updated.count !== 1) {
      return mutation(
        "STALE",
        await canonicalAfter(tx, input.ownerId, input.conversationId),
        { skippedFields: selected.map((candidate) => candidate.field) },
      );
    }
    const next = selected.reduce<TrackedLead>(
      (lead, candidate) => ({
        ...lead,
        [candidate.field]: candidate.candidateValue,
        updatedAt,
      }),
      current.lead,
    );
    await recordContactChange(tx, {
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      previous: current.lead,
      next,
      evidenceFingerprints: selected.map(
        (candidate) => candidate.evidenceFingerprint,
      ),
    });
    const partial =
      unknownTokenCount > 0 || skipped.size > 0 || alreadySatisfied.size > 0;
    return mutation(
      partial ? "PARTIAL" : "APPLIED",
      derivedViewAfterMutation(current, { lead: next }),
      {
        changed: true,
        appliedFields: selected.map((candidate) => candidate.field),
        skippedFields: [...skipped, ...alreadySatisfied],
      },
    );
  });
}

export async function dismissConversationContactSuggestion(input: {
  ownerId: string;
  conversationId: string;
  expectedLeadId: string;
  field: ContactField;
  evidenceFingerprint: string;
  reviewFingerprint: string;
}): Promise<ContactExtractionMutation> {
  return serializable(async (tx) => {
    const current = await evaluateWithClient(
      tx,
      input.ownerId,
      input.conversationId,
    );
    if (!current.lead) {
      return mutation("NOT_APPLICABLE", current.view);
    }
    if (current.view.refreshing) {
      return mutation("STALE", current.view, {
        skippedFields: [input.field],
      });
    }
    if (
      current.lead.id !== input.expectedLeadId ||
      !isContactField(input.field) ||
      !FINGERPRINT_PATTERN.test(input.evidenceFingerprint) ||
      !FINGERPRINT_PATTERN.test(input.reviewFingerprint)
    ) {
      return mutation("STALE", current.view);
    }
    const candidate = current.candidates.find(
      (item) =>
        item.field === input.field &&
        item.evidenceFingerprint === input.evidenceFingerprint,
    );
    if (
      !candidate ||
      candidate.equal ||
      candidate.reviewFingerprint !== input.reviewFingerprint
    ) {
      return mutation("STALE", current.view);
    }
    const created =
      await tx.conversationContactSuggestionDismissal.createMany({
        data: [{
          ownerId: input.ownerId,
          conversationId: input.conversationId,
          leadId: current.lead.id,
          field: persistenceField[candidate.field],
          candidateHash: candidate.candidateHash,
          evidenceFingerprint: candidate.evidenceFingerprint,
        }],
        skipDuplicates: true,
      });
    return mutation(
      "DISMISSED",
      derivedViewAfterMutation(current, { dismissed: [candidate] }),
      { changed: created.count === 1 },
    );
  });
}

export async function dismissAllConversationContactSuggestions(input: {
  ownerId: string;
  conversationId: string;
  expectedLeadId: string;
  reviewFingerprints: string[];
}): Promise<ContactExtractionMutation> {
  return serializable(async (tx) => {
    const current = await evaluateWithClient(
      tx,
      input.ownerId,
      input.conversationId,
    );
    if (!current.lead) {
      return mutation("NOT_APPLICABLE", current.view);
    }
    if (current.view.refreshing) {
      return mutation("STALE", current.view);
    }
    const expected = normalizedReviewFingerprints(input.reviewFingerprints);
    if (current.lead.id !== input.expectedLeadId || !expected) {
      return mutation("STALE", current.view);
    }
    const candidates = current.candidates.filter(
      (candidate) =>
        !candidate.equal && expected.has(candidate.reviewFingerprint),
    );
    if (candidates.length !== expected.size) {
      return mutation("STALE", current.view);
    }
    const created =
      await tx.conversationContactSuggestionDismissal.createMany({
        data: candidates.map((candidate) => ({
          ownerId: input.ownerId,
          conversationId: input.conversationId,
          leadId: current.lead!.id,
          field: persistenceField[candidate.field],
          candidateHash: candidate.candidateHash,
          evidenceFingerprint: candidate.evidenceFingerprint,
        })),
        skipDuplicates: true,
      });
    return mutation(
      "DISMISSED",
      derivedViewAfterMutation(current, { dismissed: candidates }),
      { changed: created.count > 0 },
    );
  });
}

export async function recheckConversationContactSuggestions(
  ownerId: string,
  conversationId: string,
): Promise<ContactExtractionMutation> {
  const current = await evaluateWithClient(
    prisma as unknown as ContactClient,
    ownerId,
    conversationId,
  );
  return mutation(
    current.lead ? "NO_CHANGE" : "NOT_APPLICABLE",
    current.view,
  );
}
