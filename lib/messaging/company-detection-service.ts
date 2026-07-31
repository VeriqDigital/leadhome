import "server-only";

import { createHash } from "node:crypto";
import {
  Prisma,
  type LeadSource,
  type LeadStatus,
} from "@prisma/client";
import { conversationAnalysisOutputSchema } from "@/lib/ai/conversation-analysis/schema";
import { recordActivity } from "@/lib/activity-service";
import { buildLeadUpdateActivities } from "@/lib/lead-activities";
import { prisma } from "@/lib/prisma";
import {
  businessDomainFromEmail,
  formatCompanyFromDomain,
} from "./email-domain";
import {
  externalInboundParticipantIdentity,
  normalizeEmailAddresses,
} from "./participant-identity";

const MAX_COMPANY_ASSOCIATION_ROWS = 200;
const MAX_COMPANY_MESSAGES = 100;
const MAX_OWNER_MAILBOX_ADDRESSES = 20;
const MIN_ANALYSIS_COMPANY_CONFIDENCE = 0.7;

export type CompanySuggestionSource =
  | "DOMAIN_ASSOCIATION"
  | "STRUCTURED_ANALYSIS"
  | "BUSINESS_DOMAIN";

export type ConversationCompanySuggestion = {
  value: string;
  source: CompanySuggestionSource;
  evidenceFingerprint: string;
  evidenceSummary: string;
  evidenceDetails: string[];
  automaticEligible: boolean;
};

export type ConversationCompanyView = {
  conversationId: string;
  lead: {
    id: string;
    name: string;
    email: string | null;
    company: string | null;
  } | null;
  state:
    | "NOT_APPLICABLE"
    | "COMPANY_PRESENT"
    | "SUGGESTED"
    | "NO_SUGGESTION";
  suggestion: ConversationCompanySuggestion | null;
  canRecheck: boolean;
};

export type CompanyDetectionMutation = {
  changed: boolean;
  outcome:
    | "APPLIED"
    | "DISMISSED"
    | "NO_CHANGE"
    | "STALE"
    | "NOT_APPLICABLE";
  companyView: ConversationCompanyView;
};

type DetectionClient = Pick<
  Prisma.TransactionClient,
  | "conversation"
  | "conversationCompanySuggestionDismissal"
  | "lead"
  | "leadActivity"
  | "message"
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

type AssociationLead = {
  id: string;
  email: string | null;
  company: string | null;
  updatedAt: Date;
};

type Candidate = ConversationCompanySuggestion & {
  normalizedValue: string;
};

type InternalEvaluation = {
  view: ConversationCompanyView;
  lead: TrackedLead | null;
  candidates: Candidate[];
  visibleSuggestion: Candidate | null;
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

function compactCompany(value: string | null | undefined) {
  if (!value) return null;
  const compact = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return compact && compact.length <= 120 ? compact : null;
}

function hasCompany(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function normalizeCompanyName(value: string | null | undefined) {
  const compact = compactCompany(value);
  if (!compact) return null;
  const normalized = compact
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function publicLead(lead: TrackedLead | null) {
  return lead
    ? {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        company: lead.company,
      }
    : null;
}

function viewFor(
  conversationId: string,
  lead: TrackedLead | null,
  suggestion: Candidate | null,
): ConversationCompanyView {
  if (!lead) {
    return {
      conversationId,
      lead: null,
      state: "NOT_APPLICABLE",
      suggestion: null,
      canRecheck: false,
    };
  }
  if (hasCompany(lead.company)) {
    return {
      conversationId,
      lead: publicLead(lead),
      state: "COMPANY_PRESENT",
      suggestion: null,
      canRecheck: false,
    };
  }
  return {
    conversationId,
    lead: publicLead(lead),
    state: suggestion ? "SUGGESTED" : "NO_SUGGESTION",
    suggestion,
    canRecheck: true,
  };
}

function preferredDisplay(rows: AssociationLead[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = compactCompany(row.company);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...rows]
    .filter((row) => compactCompany(row.company))
    .sort((left, right) => {
      const leftValue = compactCompany(left.company)!;
      const rightValue = compactCompany(right.company)!;
      return (
        (counts.get(rightValue) ?? 0) - (counts.get(leftValue) ?? 0) ||
        right.updatedAt.getTime() - left.updatedAt.getTime() ||
        left.id.localeCompare(right.id)
      );
    })[0]?.company?.replace(/\s+/g, " ").trim() ?? null;
}

function domainAssociationCandidate(
  domain: string,
  rows: AssociationLead[],
  overflow: boolean,
) {
  if (overflow) return { candidate: null, conflict: true };
  const sameDomainRows = rows.filter(
    (row) =>
      (row.email ? businessDomainFromEmail(row.email) : null) === domain &&
      hasCompany(row.company),
  );
  if (sameDomainRows.some((row) => !normalizeCompanyName(row.company))) {
    return { candidate: null, conflict: true };
  }
  const matching = sameDomainRows.filter((row) =>
    normalizeCompanyName(row.company));
  const groups = new Map<string, AssociationLead[]>();
  for (const row of matching) {
    const normalized = normalizeCompanyName(row.company)!;
    groups.set(normalized, [...(groups.get(normalized) ?? []), row]);
  }
  if (groups.size > 1) return { candidate: null, conflict: true };
  const group = [...groups.entries()][0];
  if (!group) return { candidate: null, conflict: false };
  const [normalizedValue, companyRows] = group;
  const value = preferredDisplay(companyRows);
  if (!value) return { candidate: null, conflict: false };
  return {
    conflict: false,
    candidate: {
      value,
      normalizedValue,
      source: "DOMAIN_ASSOCIATION" as const,
      evidenceFingerprint: fingerprint({
        version: 1,
        source: "DOMAIN_ASSOCIATION",
        domain,
        normalizedValue,
      }),
      evidenceSummary: "Known from existing leads with this email domain",
      evidenceDetails: [
        `Email domain: ${domain}`,
        `${companyRows.length} owned lead${companyRows.length === 1 ? "" : "s"} use this company`,
      ],
      automaticEligible: true,
    },
  };
}

function analysisCandidate(analysis: {
  id: string;
  status: string;
  contentHash: string | null;
  analysisVersion: string;
  structuredData: Prisma.JsonValue | null;
  completedAt: Date | null;
}) {
  if (!analysis.completedAt || !analysis.structuredData) return null;
  const parsed = conversationAnalysisOutputSchema.safeParse(
    analysis.structuredData,
  );
  if (!parsed.success) return null;
  const company = compactCompany(parsed.data.company.value);
  const normalizedValue = normalizeCompanyName(company);
  if (
    !company ||
    !normalizedValue ||
    parsed.data.company.confidence < MIN_ANALYSIS_COMPANY_CONFIDENCE ||
    !parsed.data.company.evidenceMessageOrdinals.length
  ) {
    return null;
  }
  const evidenceMessageOrdinals = [
    ...new Set(parsed.data.company.evidenceMessageOrdinals),
  ].sort((left, right) => left - right);
  return {
    value: company,
    normalizedValue,
    source: "STRUCTURED_ANALYSIS" as const,
    evidenceFingerprint: fingerprint({
      version: 1,
      source: "STRUCTURED_ANALYSIS",
      normalizedValue,
      contentHash: analysis.contentHash,
      analysisVersion: analysis.analysisVersion,
      evidenceMessageOrdinals,
    }),
    evidenceSummary: "Detected from conversation analysis",
    evidenceDetails: [
      `Analysis cited ${evidenceMessageOrdinals.length} message${
        evidenceMessageOrdinals.length === 1 ? "" : "s"
      }`,
      `Confidence: ${Math.round(parsed.data.company.confidence * 100)}%`,
    ],
    automaticEligible: false,
  };
}

function domainDerivedCandidate(domain: string) {
  const value = formatCompanyFromDomain(domain);
  const normalizedValue = normalizeCompanyName(value);
  if (!value || !normalizedValue) return null;
  return {
    value,
    normalizedValue,
    source: "BUSINESS_DOMAIN" as const,
    evidenceFingerprint: fingerprint({
      version: 1,
      source: "BUSINESS_DOMAIN",
      domain,
      normalizedValue,
    }),
    evidenceSummary: "Detected from sender domain",
    evidenceDetails: [`Email domain: ${domain}`],
    automaticEligible: false,
  };
}

function orderedCandidates({
  domain,
  associations,
  overflow,
  domainConflict,
  analysis,
}: {
  domain: string | null;
  associations: AssociationLead[];
  overflow: boolean;
  domainConflict: boolean;
  analysis: {
    id: string;
    status: string;
    contentHash: string | null;
    analysisVersion: string;
    structuredData: Prisma.JsonValue | null;
    completedAt: Date | null;
  } | null;
}) {
  const association = domain
    ? domainAssociationCandidate(domain, associations, overflow)
    : { candidate: null, conflict: false };
  const structured = analysis ? analysisCandidate(analysis) : null;
  const derived =
    domain && !association.conflict ? domainDerivedCandidate(domain) : null;

  if (
    association.candidate &&
    (
      domainConflict ||
      (
        structured &&
        association.candidate.normalizedValue !== structured.normalizedValue
      )
    )
  ) {
    association.candidate.automaticEligible = false;
  }

  const unique = new Map<string, Candidate>();
  for (const candidate of [
    association.candidate,
    structured,
    derived,
  ]) {
    if (candidate && !unique.has(candidate.normalizedValue)) {
      unique.set(candidate.normalizedValue, candidate);
    }
  }
  return [...unique.values()];
}

async function evaluateWithClient(
  client: DetectionClient,
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
          communicationAccounts: {
            where: {
              address: { not: null },
            },
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
          id: true,
          status: true,
          contentHash: true,
          analysisVersion: true,
          structuredData: true,
          completedAt: true,
        },
      },
      messages: {
        where: { direction: "INBOUND" },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: MAX_COMPANY_MESSAGES,
        select: {
          id: true,
          direction: true,
          sender: true,
          replyTo: true,
        },
      },
    },
  });
  if (!conversation?.lead || conversation.lead.userId !== ownerId) {
    return {
      view: viewFor(conversationId, null, null),
      lead: null,
      candidates: [],
      visibleSuggestion: null,
    };
  }
  const lead = conversation.lead;
  if (hasCompany(lead.company)) {
    return {
      view: viewFor(conversationId, lead, null),
      lead,
      candidates: [],
      visibleSuggestion: null,
    };
  }

  const ownerMailboxAccounts =
    conversation.owner.communicationAccounts ?? [];
  if (ownerMailboxAccounts.length > MAX_OWNER_MAILBOX_ADDRESSES) {
    return {
      view: viewFor(conversationId, lead, null),
      lead,
      candidates: [],
      visibleSuggestion: null,
    };
  }
  const excludedAddresses = [
    conversation.account.address,
    conversation.owner.email,
    ...ownerMailboxAccounts.map(
      (account) => account.address,
    ),
  ];
  const identity = externalInboundParticipantIdentity(
    [...conversation.messages].reverse(),
    excludedAddresses,
    MAX_COMPANY_MESSAGES,
  );
  const externalEmails = [
    ...identity.senderEmails,
    ...identity.replyToEmails,
  ];
  if (!externalEmails.length && !identity.displayNames.length) {
    return {
      view: viewFor(conversationId, lead, null),
      lead,
      candidates: [],
      visibleSuggestion: null,
    };
  }

  const senderDomains = [
    ...new Set(identity.senderEmails.flatMap((email) =>
      businessDomainFromEmail(email) ?? [])),
  ];
  const replyToDomains = [
    ...new Set(identity.replyToEmails.flatMap((email) =>
      businessDomainFromEmail(email) ?? [])),
  ];
  const excludedEmails = new Set(
    normalizeEmailAddresses(
      excludedAddresses.filter(
        (value): value is string => typeof value === "string",
      ),
    ),
  );
  const excludedEmailList = [...excludedEmails];
  const normalizedLeadEmails = normalizeEmailAddresses(lead.email);
  const leadDomain =
    externalEmails.length > 0 &&
    normalizedLeadEmails.length === 1 &&
    !excludedEmails.has(normalizedLeadEmails[0])
      ? businessDomainFromEmail(normalizedLeadEmails[0])
      : null;
  const preferredDomains = senderDomains.length
    ? senderDomains
    : replyToDomains.length
      ? replyToDomains
      : leadDomain
        ? [leadDomain]
        : [];
  const domain = preferredDomains.length === 1
    ? preferredDomains[0]
    : null;
  const evidenceDomains = new Set([
    ...senderDomains,
    ...replyToDomains,
    ...(leadDomain ? [leadDomain] : []),
  ]);
  const domainConflict = Boolean(
    domain &&
    [...evidenceDomains].some((evidenceDomain) => evidenceDomain !== domain),
  );

  const associationRows = domain
    ? await client.lead.findMany({
        where: {
          userId: ownerId,
          id: { not: lead.id },
          email: { not: null },
          OR: [
            {
              email: {
                endsWith: `@${domain}`,
                mode: "insensitive",
              },
            },
            {
              email: {
                endsWith: `.${domain}`,
                mode: "insensitive",
              },
            },
          ],
          company: { not: null },
          ...(excludedEmailList.length
            ? {
                NOT: excludedEmailList.map((email) => ({
                  email: { equals: email, mode: "insensitive" as const },
                })),
              }
            : {}),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: MAX_COMPANY_ASSOCIATION_ROWS + 1,
        select: {
          id: true,
          email: true,
          company: true,
          updatedAt: true,
        },
      })
    : [];
  const overflow = associationRows.length > MAX_COMPANY_ASSOCIATION_ROWS;
  const usableAssociationRows = associationRows.filter((row) => {
    const emails = normalizeEmailAddresses(row.email);
    return emails.length === 1 && !excludedEmails.has(emails[0]);
  });
  const candidates = orderedCandidates({
    domain,
    associations: usableAssociationRows.slice(
      0,
      MAX_COMPANY_ASSOCIATION_ROWS,
    ),
    overflow,
    domainConflict,
    analysis: conversation.analysis,
  });
  const dismissals = candidates.length
    ? await client.conversationCompanySuggestionDismissal.findMany({
        where: {
          ownerId,
          conversationId,
          leadId: lead.id,
          evidenceFingerprint: {
            in: candidates.map((candidate) => candidate.evidenceFingerprint),
          },
        },
        take: candidates.length,
        select: { evidenceFingerprint: true },
      })
    : [];
  const dismissed = new Set(
    dismissals.map((dismissal) => dismissal.evidenceFingerprint),
  );
  const visibleSuggestion =
    candidates.find(
      (candidate) => !dismissed.has(candidate.evidenceFingerprint),
    ) ?? null;
  return {
    view: viewFor(conversationId, lead, visibleSuggestion),
    lead,
    candidates,
    visibleSuggestion,
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
  throw new Error("Company detection transaction did not complete.");
}

async function applyCandidate({
  ownerId,
  conversationId,
  expectedLeadId,
  expectedFingerprint,
  automaticOnly,
}: {
  ownerId: string;
  conversationId: string;
  expectedLeadId?: string;
  expectedFingerprint?: string;
  automaticOnly: boolean;
}): Promise<CompanyDetectionMutation> {
  return serializable(async (tx) => {
    const current = await evaluateWithClient(
      tx,
      ownerId,
      conversationId,
    );
    if (!current.lead) {
      return {
        changed: false,
        outcome: "NOT_APPLICABLE",
        companyView: current.view,
      };
    }
    if (current.view.state === "COMPANY_PRESENT") {
      return {
        changed: false,
        outcome: "STALE",
        companyView: current.view,
      };
    }
    const candidate = current.visibleSuggestion;
    if (
      !candidate ||
      (automaticOnly && !candidate.automaticEligible) ||
      (expectedLeadId && current.lead.id !== expectedLeadId) ||
      (expectedFingerprint &&
        candidate.evidenceFingerprint !== expectedFingerprint)
    ) {
      return {
        changed: false,
        outcome: expectedFingerprint ? "STALE" : "NO_CHANGE",
        companyView: current.view,
      };
    }

    const updated = await tx.lead.updateMany({
      where: {
        id: current.lead.id,
        userId: ownerId,
        company: current.lead.company,
        updatedAt: current.lead.updatedAt,
        conversations: {
          some: {
            id: conversationId,
            ownerId,
            leadId: current.lead.id,
          },
        },
      },
      data: { company: candidate.value },
    });
    if (updated.count !== 1) {
      const canonical = await evaluateWithClient(
        tx,
        ownerId,
        conversationId,
      );
      return {
        changed: false,
        outcome: "STALE",
        companyView: canonical.view,
      };
    }

    const companyActivity = buildLeadUpdateActivities(current.lead, {
      ...current.lead,
      company: candidate.value,
    }).find((activity) => activity.type === "COMPANY_CHANGED");
    if (!companyActivity) {
      throw new Error("Company activity was not generated.");
    }
    await recordActivity(tx, {
      ...companyActivity,
      ownerId,
      leadId: current.lead.id,
      conversationId,
      actorType: automaticOnly ? "SYSTEM" : "USER",
      source: "INBOX",
      idempotencyKey:
        `company-detection:${conversationId}:${current.lead.id}:` +
        fingerprint({
          version: 1,
          evidenceFingerprint: candidate.evidenceFingerprint,
          previousUpdatedAt: current.lead.updatedAt.toISOString(),
        }),
    });
    const canonical = await evaluateWithClient(
      tx,
      ownerId,
      conversationId,
    );
    return {
      changed: true,
      outcome: "APPLIED",
      companyView: canonical.view,
    };
  });
}

export async function getConversationCompanyView(
  ownerId: string,
  conversationId: string,
) {
  return (
    await evaluateWithClient(
      prisma as unknown as DetectionClient,
      ownerId,
      conversationId,
    )
  ).view;
}

export function detectAndApplyConversationCompany(
  ownerId: string,
  conversationId: string,
) {
  return applyCandidate({
    ownerId,
    conversationId,
    automaticOnly: true,
  });
}

export function applyConversationCompanySuggestion(input: {
  ownerId: string;
  conversationId: string;
  expectedLeadId: string;
  evidenceFingerprint: string;
}) {
  return applyCandidate({
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    expectedLeadId: input.expectedLeadId,
    expectedFingerprint: input.evidenceFingerprint,
    automaticOnly: false,
  });
}

export async function dismissConversationCompanySuggestion(input: {
  ownerId: string;
  conversationId: string;
  expectedLeadId: string;
  evidenceFingerprint: string;
}): Promise<CompanyDetectionMutation> {
  return serializable(async (tx) => {
    const current = await evaluateWithClient(
      tx,
      input.ownerId,
      input.conversationId,
    );
    if (
      !current.lead ||
      current.lead.id !== input.expectedLeadId ||
      current.view.state === "COMPANY_PRESENT"
    ) {
      return {
        changed: false,
        outcome: "STALE",
        companyView: current.view,
      };
    }
    const candidate = current.candidates.find(
      (item) => item.evidenceFingerprint === input.evidenceFingerprint,
    );
    if (!candidate) {
      return {
        changed: false,
        outcome: "STALE",
        companyView: current.view,
      };
    }
    const created =
      await tx.conversationCompanySuggestionDismissal.createMany({
        data: [{
          ownerId: input.ownerId,
          conversationId: input.conversationId,
          leadId: current.lead.id,
          candidateValue: candidate.value,
          evidenceSource: candidate.source,
          evidenceFingerprint: candidate.evidenceFingerprint,
        }],
        skipDuplicates: true,
      });
    const canonical = await evaluateWithClient(
      tx,
      input.ownerId,
      input.conversationId,
    );
    return {
      changed: created.count === 1,
      outcome: "DISMISSED",
      companyView: canonical.view,
    };
  });
}

export function recheckConversationCompany(
  ownerId: string,
  conversationId: string,
) {
  return detectAndApplyConversationCompany(ownerId, conversationId);
}

export async function detectCompanyAfterAttachment(
  ownerId: string,
  conversationId: string,
) {
  try {
    return await detectAndApplyConversationCompany(
      ownerId,
      conversationId,
    );
  } catch (error) {
    console.error("[LeadHome] company detection failed", {
      event: "company_detection_after_attachment_failed",
      ownerId,
      conversationId,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}
