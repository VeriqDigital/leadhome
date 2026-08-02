import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    conversation: {
      findFirst: vi.fn(),
    },
    conversationContactSuggestionDismissal: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    lead: {
      updateMany: vi.fn(),
    },
    leadActivity: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    job: {
      findFirst: vi.fn(),
    },
    message: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
  };
  return {
    client,
    transaction: vi.fn(),
    recordActivity: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...mocks.client,
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/activity-service", () => ({
  recordActivity: mocks.recordActivity,
}));
vi.mock("@/lib/ai/config", () => ({
  getConversationAnalysisConfig: () => ({
    apiKey: null,
    model: null,
    maxInputChars: 60_000,
    requestTimeoutMs: 45_000,
    analysisVersion: "conversation-v1",
  }),
}));

import {
  applyAvailableConversationContactSuggestions,
  applyConversationContactSuggestion,
  dismissAllConversationContactSuggestions,
  dismissConversationContactSuggestion,
  getConversationContactExtractionView,
  recheckConversationContactSuggestions,
  type ContactField,
} from "./contact-extraction-service";

type LeadState = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: "MANUAL";
  status: "NEW";
  message: string | null;
  estimatedValue: null;
  nextFollowUpDate: Date | null;
  updatedAt: Date;
};

type MessageState = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  sender: string;
  receivedAt: Date;
  createdAt: Date;
};

type AnalysisState = ReturnType<typeof analysis>;

type DismissalRow = {
  ownerId: string;
  conversationId: string;
  leadId: string;
  field: "NAME" | "EMAIL" | "PHONE";
  candidateHash: string;
  evidenceFingerprint: string;
};

const BASE_TIME = new Date("2026-08-01T12:00:00.000Z");

function lead(overrides: Partial<LeadState> = {}): LeadState {
  return {
    id: "lead-a",
    userId: "owner-a",
    name: "Existing Lead",
    email: null,
    phone: null,
    company: null,
    source: "MANUAL",
    status: "NEW",
    message: null,
    estimatedValue: null,
    nextFollowUpDate: null,
    updatedAt: new Date("2026-08-01T10:00:00.000Z"),
    ...overrides,
  };
}

function inbound(
  sender = "Tom Johnson <tom@northstarroofing.com>",
  offsetMinutes = 0,
): MessageState {
  const receivedAt = new Date(BASE_TIME.getTime() + offsetMinutes * 60_000);
  return {
    id: `inbound-${offsetMinutes}-${sender}`,
    direction: "INBOUND",
    sender,
    receivedAt,
    createdAt: receivedAt,
  };
}

function outbound(
  sender = "Owner <owner@leadhome.app>",
  offsetMinutes = 0,
): MessageState {
  const receivedAt = new Date(BASE_TIME.getTime() + offsetMinutes * 60_000);
  return {
    id: `outbound-${offsetMinutes}-${sender}`,
    direction: "OUTBOUND",
    sender,
    receivedAt,
    createdAt: receivedAt,
  };
}

function analysis(
  contact: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } = {},
  options: {
    contentHash?: string;
    analysisVersion?: string;
    sourceMessageCount?: number;
    completedAt?: Date;
    status?: string;
    evidenceMessageOrdinals?: number[];
    structuredData?: unknown;
    latestJobId?: string | null;
  } = {},
) {
  return {
    latestJobId: options.latestJobId ?? null,
    status: options.status ?? "COMPLETED",
    contentHash: options.contentHash ?? "content-a",
    analysisVersion: options.analysisVersion ?? "conversation-v1",
    sourceMessageCount: options.sourceMessageCount ?? 1,
    completedAt:
      options.completedAt ?? new Date("2026-08-01T14:00:00.000Z"),
    structuredData: options.structuredData ?? {
      summary: "A customer asked about a project.",
      company: {
        value: null,
        confidence: 0,
        evidenceMessageOrdinals: [],
      },
      contact: {
        name: contact.name ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        confidence: 0.91,
        evidenceMessageOrdinals:
          options.evidenceMessageOrdinals ?? [1],
      },
      projectType: {
        value: null,
        confidence: 0,
        evidenceMessageOrdinals: [],
      },
      budget: {
        minimumAmount: null,
        maximumAmount: null,
        currency: null,
        rawText: null,
        confidence: 0,
        evidenceMessageOrdinals: [],
      },
      timeline: {
        targetDate: null,
        rawText: null,
        confidence: 0,
        evidenceMessageOrdinals: [],
      },
      sentiment: {
        value: "NEUTRAL",
        confidence: 0.5,
      },
      actionItems: [],
      missingInformation: [],
    },
  };
}

function setup(options: {
  ownerId?: string;
  conversationId?: string;
  lead?: LeadState | null;
  messages?: MessageState[];
  analysis?: AnalysisState | null;
  intelligenceEnabled?: boolean;
  accountAddress?: string | null;
  ownerEmail?: string;
  ownerMailboxAddresses?: Array<string | null>;
  messageCount?: number;
  forceUpdateFailure?: boolean;
  jobStatus?: "PENDING" | "RUNNING" | "RETRY_SCHEDULED" | "COMPLETED" | null;
} = {}) {
  const ownerId = options.ownerId ?? "owner-a";
  const conversationId = options.conversationId ?? "conversation-a";
  let currentLead = options.lead === undefined ? lead() : options.lead;
  let currentMessages = options.messages ?? [inbound()];
  let currentAnalysis = options.analysis ?? null;
  let messageCountOverride = options.messageCount;
  let forceUpdateFailure = options.forceUpdateFailure ?? false;
  let currentJobStatus = options.jobStatus ?? null;
  const dismissals: DismissalRow[] = [];
  let updateSequence = 0;

  mocks.client.conversation.findFirst.mockImplementation(
    async (input: { where?: { id?: string; ownerId?: string } }) => {
      if (
        input.where?.id !== conversationId ||
        input.where?.ownerId !== ownerId
      ) {
        return null;
      }
      const messages = currentMessages
        .filter((message) => message.direction === "INBOUND")
        .sort((left, right) =>
          right.receivedAt.getTime() - left.receivedAt.getTime() ||
          right.id.localeCompare(left.id))
        .slice(0, 100);
      return {
        id: conversationId,
        owner: {
          email: options.ownerEmail ?? "owner@leadhome.app",
          conversationIntelligenceEnabled:
            options.intelligenceEnabled ?? true,
          communicationAccounts: (
            options.ownerMailboxAddresses ?? []
          ).map((address) => ({ address })),
        },
        account: {
          address: options.accountAddress ?? "inbox@leadhome.app",
        },
        lead: currentLead,
        analysis: currentAnalysis,
        _count: {
          messages: messageCountOverride ?? currentMessages.length,
        },
        messages,
      };
    },
  );

  mocks.client.message.findFirst.mockImplementation(async (input: {
    where?: {
      conversationId?: string;
      direction?: string;
      conversation?: { ownerId?: string };
    };
    skip?: number;
  }) => {
    if (
      input.where?.conversationId !== conversationId ||
      input.where?.direction !== "INBOUND" ||
      input.where?.conversation?.ownerId !== ownerId
    ) {
      return null;
    }
    const messages = currentMessages
      .filter((message) => message.direction === "INBOUND")
      .sort((left, right) =>
        right.receivedAt.getTime() - left.receivedAt.getTime() ||
        right.id.localeCompare(left.id));
    const message = messages[input.skip ?? 0];
    return message ? { id: message.id } : null;
  });

  mocks.client.job.findFirst.mockImplementation(async (input: {
    where?: { id?: string; ownerId?: string; type?: string };
  }) => {
    if (
      !currentAnalysis?.latestJobId ||
      input.where?.id !== currentAnalysis.latestJobId ||
      input.where?.ownerId !== ownerId ||
      input.where?.type !== "CONVERSATION_ANALYSIS" ||
      !currentJobStatus
    ) {
      return null;
    }
    return { status: currentJobStatus };
  });

  mocks.client.conversationContactSuggestionDismissal.findMany
    .mockImplementation(async (input: {
      where?: {
        ownerId?: string;
        conversationId?: string;
        leadId?: string;
        OR?: Array<{
          field: DismissalRow["field"];
          candidateHash: string;
          evidenceFingerprint: string;
        }>;
      };
    }) => {
      if (
        input.where?.ownerId !== ownerId ||
        input.where?.conversationId !== conversationId ||
        input.where?.leadId !== currentLead?.id
      ) {
        return [];
      }
      const requested = input.where.OR ?? [];
      return dismissals.filter((row) => requested.some((candidate) =>
        candidate.field === row.field &&
        candidate.candidateHash === row.candidateHash &&
        candidate.evidenceFingerprint === row.evidenceFingerprint));
    });

  mocks.client.conversationContactSuggestionDismissal.createMany
    .mockImplementation(async (input: {
      data: DismissalRow[];
      skipDuplicates?: boolean;
    }) => {
      let count = 0;
      for (const row of input.data) {
        const duplicate = dismissals.some((item) =>
          item.ownerId === row.ownerId &&
          item.conversationId === row.conversationId &&
          item.leadId === row.leadId &&
          item.field === row.field &&
          item.candidateHash === row.candidateHash &&
          item.evidenceFingerprint === row.evidenceFingerprint);
        if (!duplicate) {
          dismissals.push(row);
          count += 1;
        }
      }
      return { count };
    });

  mocks.client.lead.updateMany.mockImplementation(async (input: {
    where: Record<string, unknown> & {
      id?: string;
      userId?: string;
      updatedAt?: Date;
      conversations?: {
        some?: { id?: string; ownerId?: string; leadId?: string };
      };
    };
    data: Partial<Pick<LeadState, ContactField | "updatedAt">>;
  }) => {
    if (forceUpdateFailure || !currentLead) return { count: 0 };
    const attached = input.where.conversations?.some;
    if (
      input.where.id !== currentLead.id ||
      input.where.userId !== ownerId ||
      input.where.updatedAt?.getTime() !== currentLead.updatedAt.getTime() ||
      attached?.id !== conversationId ||
      attached.ownerId !== ownerId ||
      attached.leadId !== currentLead.id
    ) {
      return { count: 0 };
    }
    for (const field of ["name", "email", "phone"] as const) {
      if (
        Object.prototype.hasOwnProperty.call(input.where, field) &&
        input.where[field] !== currentLead[field]
      ) {
        return { count: 0 };
      }
    }
    updateSequence += 1;
    currentLead = {
      ...currentLead,
      ...input.data,
      updatedAt:
        input.data.updatedAt ??
        new Date(currentLead.updatedAt.getTime() + updateSequence * 1_000),
    };
    return { count: 1 };
  });

  return {
    get lead() {
      return currentLead;
    },
    get dismissals() {
      return [...dismissals];
    },
    attach(nextLead: LeadState) {
      currentLead = nextLead;
    },
    detach() {
      currentLead = null;
    },
    setAnalysis(nextAnalysis: AnalysisState | null) {
      currentAnalysis = nextAnalysis;
    },
    setJobStatus(
      status: "PENDING" | "RUNNING" | "RETRY_SCHEDULED" | "COMPLETED" | null,
    ) {
      currentJobStatus = status;
    },
    setMessages(nextMessages: MessageState[], count?: number) {
      currentMessages = nextMessages;
      messageCountOverride = count;
    },
    manualEdit(update: Partial<Pick<LeadState, ContactField>>) {
      if (!currentLead) return;
      currentLead = {
        ...currentLead,
        ...update,
        updatedAt: new Date(currentLead.updatedAt.getTime() + 60_000),
      };
    },
    failUpdates(value = true) {
      forceUpdateFailure = value;
    },
  };
}

function byField<T extends { field: ContactField }>(
  values: T[],
  field: ContactField,
) {
  const value = values.find((item) => item.field === field);
  if (!value) throw new Error(`Missing ${field} suggestion.`);
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.transaction.mockImplementation(
    async (
      operation: (client: typeof mocks.client) => Promise<unknown>,
    ) => operation(mocks.client),
  );
  mocks.recordActivity.mockResolvedValue({ created: true });
});

describe("reviewed contact extraction evidence", () => {
  it("extracts deterministic sender email and name with stable fingerprints and bounded queries", async () => {
    setup({
      messages: [
        outbound("Owner <owner@leadhome.app>", 1),
        inbound('"Tom   Johnson" <TOM@NorthstarRoofing.com>'),
      ],
    });

    const first = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );
    const second = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    expect(first).toMatchObject({
      state: "READY",
      ambiguous: false,
      lead: { id: "lead-a", name: "Existing Lead" },
      suggestions: [
        {
          field: "name",
          candidateValue: "Tom Johnson",
          currentValue: "Existing Lead",
          source: "external_sender",
          reasonCode: "EXTERNAL_SENDER_NAME",
          conflict: true,
        },
        {
          field: "email",
          candidateValue: "tom@northstarroofing.com",
          currentValue: null,
          source: "external_sender",
          reasonCode: "EXTERNAL_SENDER_EMAIL",
          conflict: false,
        },
      ],
    });
    expect(second.suggestions.map((item) => ({
      evidence: item.evidenceFingerprint,
      review: item.reviewFingerprint,
    }))).toEqual(first.suggestions.map((item) => ({
      evidence: item.evidenceFingerprint,
      review: item.reviewFingerprint,
    })));
    expect(second.reviewFingerprint).toBe(first.reviewFingerprint);

    const query = mocks.client.conversation.findFirst.mock.calls[0][0];
    expect(query.select.messages.take).toBe(100);
    expect(query.select.messages.where).toEqual({ direction: "INBOUND" });
    expect(query.select.messages.select).toEqual({
      direction: true,
      sender: true,
      receivedAt: true,
      createdAt: true,
    });
    expect(query.select.owner.select.communicationAccounts.take).toBe(21);
    expect(mocks.client.message.findFirst).not.toHaveBeenCalled();
    const dismissalQuery =
      mocks.client.conversationContactSuggestionDismissal.findMany
        .mock.calls[0][0];
    expect(dismissalQuery.take).toBeLessThanOrEqual(3);
  });

  it("ignores owner aliases, outbound senders, system mailboxes, and invalid addresses", async () => {
    setup({
      ownerMailboxAddresses: ["alias@owner-company.com"],
      messages: [
        inbound("Owner <owner@leadhome.app>", -2),
        inbound("Inbox <inbox@leadhome.app>", -1),
        inbound("Owner Alias <alias@owner-company.com>"),
        outbound("External <external@northstarroofing.com>", 1),
        inbound("No Reply <no-reply@notifications.com>", 2),
        inbound("broken-address@invalid", 3),
      ],
    });

    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({
      state: "NO_SUGGESTIONS",
      suggestions: [],
    });
  });

  it("fails closed when older inbound identities exist beyond the 100-row evidence window", async () => {
    const recent = Array.from({ length: 100 }, (_, index) =>
      inbound("Tom Johnson <tom@northstarroofing.com>", index + 1));
    setup({
      messages: [
        inbound("Jordan Customer <jordan@clientco.com>", -1),
        ...recent,
      ],
    });

    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({
      state: "AMBIGUOUS",
      ambiguous: true,
      suggestions: [],
    });
    expect(mocks.client.message.findFirst).toHaveBeenCalledWith({
      where: {
        conversationId: "conversation-a",
        direction: "INBOUND",
        conversation: { ownerId: "owner-a" },
      },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      skip: 100,
      select: { id: true },
    });

    mocks.client.message.findFirst.mockClear();
    setup({ messages: recent });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({
      state: "READY",
      ambiguous: false,
    });
    expect(mocks.client.message.findFirst).toHaveBeenCalledOnce();
  });

  it("returns no sender suggestion for an outbound-only conversation", async () => {
    setup({
      messages: [outbound("Tom Johnson <tom@northstarroofing.com>")],
    });

    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({
      state: "NO_SUGGESTIONS",
      suggestions: [],
    });
  });

  it("suppresses a generic display name without discarding a credible email", async () => {
    setup({ messages: [inbound("Customer Support <help@vendor.com>")] });

    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    expect(view.suggestions).toHaveLength(1);
    expect(view.suggestions[0]).toMatchObject({
      field: "email",
      candidateValue: "help@vendor.com",
    });
  });

  it("fails closed on multiple credible external identities", async () => {
    setup({
      messages: [
        inbound("Tom Johnson <tom@northstarroofing.com>"),
        inbound("Jane Smith <jane@clientco.com>", 1),
      ],
    });

    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({
      state: "AMBIGUOUS",
      ambiguous: true,
      suggestions: [],
    });
  });

  it("fails closed when a name-only sender is unrelated to the unique email sender", async () => {
    setup({
      messages: [
        inbound("Jane Smith"),
        inbound("tom@northstarroofing.com", 1),
      ],
    });

    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({
      state: "PARTIAL",
      ambiguous: true,
      ambiguousFields: ["name"],
      suggestions: [{
        field: "email",
        candidateValue: "tom@northstarroofing.com",
      }],
    });
  });

  it("hides normalized-equal values, marks populated differences as conflicts, and leaves blanks safe", async () => {
    setup({
      lead: lead({
        name: "tom johnson",
        email: "other@clientco.com",
        phone: null,
      }),
    });

    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    expect(view.suggestions).toEqual([
      expect.objectContaining({
        field: "email",
        candidateValue: "tom@northstarroofing.com",
        currentValue: "other@clientco.com",
        conflict: true,
      }),
    ]);
  });

  it("does not expose unattached, cross-owner, or mailbox-overflow conversations", async () => {
    setup({ lead: null });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({ state: "NOT_APPLICABLE", lead: null });

    setup({ lead: lead({ userId: "owner-b" }) });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({ state: "NOT_APPLICABLE", lead: null });

    setup({
      ownerMailboxAddresses: Array.from(
        { length: 21 },
        (_, index) => `alias-${index}@owner-company.com`,
      ),
    });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({
      state: "AMBIGUOUS",
      ambiguousFields: ["name", "email"],
      suggestions: [],
    });
  });

  it("surfaces validated fresh analysis name, email, and phone evidence", async () => {
    setup({
      messages: [inbound("No Reply <no-reply@notifications.com>")],
      analysis: analysis({
        name: "Jordan Customer",
        email: "jordan@clientco.com",
        phone: "+1 (515) 555-0100",
      }),
    });

    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    expect(view.state).toBe("READY");
    expect(view.suggestions).toEqual([
      expect.objectContaining({
        field: "name",
        candidateValue: "Jordan Customer",
        reasonCode: "ANALYSIS_CONTACT_NAME",
        conflict: true,
      }),
      expect.objectContaining({
        field: "email",
        candidateValue: "jordan@clientco.com",
        reasonCode: "ANALYSIS_CONTACT_EMAIL",
        conflict: false,
      }),
      expect.objectContaining({
        field: "phone",
        candidateValue: "+1 (515) 555-0100",
        reasonCode: "ANALYSIS_CONTACT_PHONE",
        conflict: false,
      }),
    ]);
  });

  it("rejects disabled, stale, uncited, malformed, and invalid analysis evidence", async () => {
    const staleAnalysis = analysis({
      name: "Customer Support",
      email: "no-reply@notifications.com",
      phone: "555",
    });
    setup({
      intelligenceEnabled: false,
      messages: [inbound("no-reply@notifications.com")],
      analysis: staleAnalysis,
    });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({ state: "NO_SUGGESTIONS" });

    setup({
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({ email: "customer@clientco.com" }, {
        sourceMessageCount: 2,
      }),
    });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({ state: "NO_SUGGESTIONS" });

    setup({
      messages: [inbound("no-reply@notifications.com", 180)],
      analysis: analysis({ email: "customer@clientco.com" }),
    });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({ state: "NO_SUGGESTIONS" });

    setup({
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({ email: "customer@clientco.com" }, {
        evidenceMessageOrdinals: [],
      }),
    });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({ state: "NO_SUGGESTIONS" });

    setup({
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({}, { structuredData: { invalid: true } }),
    });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({ state: "NO_SUGGESTIONS" });
  });

  it("rejects invalid structured email, malformed phone, and generic analysis name", async () => {
    setup({
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({}, {
        structuredData: {
          ...analysis().structuredData,
          contact: {
            name: null,
            email: "not-an-email",
            phone: null,
            confidence: 0.9,
            evidenceMessageOrdinals: [1],
          },
        },
      }),
    });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({ state: "NO_SUGGESTIONS" });

    setup({
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({
        name: "Account Verification Team",
        phone: "call me tomorrow",
      }),
    });
    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({ state: "NO_SUGGESTIONS" });

    for (const phone of [
      "2026-08-01",
      "111-111-1111",
      "(515 555-0100",
    ]) {
      setup({
        messages: [inbound("no-reply@notifications.com")],
        analysis: analysis({ phone }),
      });
      await expect(getConversationContactExtractionView(
        "owner-a",
        "conversation-a",
      )).resolves.toMatchObject({ state: "NO_SUGGESTIONS" });
    }
  });

  it("normalizes readable phone formatting before deciding a value is equal", async () => {
    setup({
      lead: lead({
        name: "Jordan Customer",
        phone: "5155550100",
      }),
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({ phone: "(515) 555-0100" }),
    });

    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({
      state: "NO_SUGGESTIONS",
      suggestions: [],
    });
  });

  it("does not flash old AI contact evidence while a newer analysis job is running", async () => {
    setup({
      messages: [inbound("Mick Enev <mickenev1@gmail.com>")],
      analysis: analysis({
        name: "Old Analysis Name",
        email: "old-analysis@example.com",
        phone: "515-555-0100",
      }, {
        latestJobId: "job-new-analysis",
      }),
      jobStatus: "RUNNING",
    });

    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    expect(view).toMatchObject({
      state: "REFRESHING",
      refreshing: true,
      ambiguous: false,
      ambiguousFields: [],
      reviewFingerprint: null,
      suggestions: [{
        field: "email",
        candidateValue: "mickenev1@gmail.com",
        source: "external_sender",
      }],
    });
    expect(view.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "conversation_analysis" }),
    ]));
    expect(view.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "name" }),
    ]));
    expect(mocks.client.job.findFirst).toHaveBeenCalledWith({
      where: {
        id: "job-new-analysis",
        ownerId: "owner-a",
        type: "CONVERSATION_ANALYSIS",
      },
      select: { status: true },
    });
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("shows a refreshing explanation state when no deterministic evidence is safe", async () => {
    setup({
      messages: [inbound("No Reply <no-reply@notifications.com>")],
      analysis: analysis({ phone: "515-555-0100" }, {
        status: "QUEUED",
        latestJobId: "job-new-analysis",
      }),
      jobStatus: "PENDING",
    });

    await expect(getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).resolves.toMatchObject({
      state: "REFRESHING",
      refreshing: true,
      suggestions: [],
      reviewFingerprint: null,
    });
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("replaces refreshing state with one canonical field-level result after completion", async () => {
    const state = setup({
      messages: [inbound("Mick Enev <mickenev1@gmail.com>")],
      analysis: analysis({ name: "Old Name" }, {
        status: "RUNNING",
        latestJobId: "job-new-analysis",
      }),
      jobStatus: "RUNNING",
    });
    const pending = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    state.setAnalysis(analysis({
      name: "Tom Johnson",
      email: "mickenev1@gmail.com",
      phone: "515-555-0123",
    }, {
      latestJobId: "job-new-analysis",
    }));
    state.setJobStatus("COMPLETED");
    const completed = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    expect(pending.state).toBe("REFRESHING");
    expect(completed).toMatchObject({
      state: "PARTIAL",
      refreshing: false,
      ambiguous: true,
      ambiguousFields: ["name"],
    });
    expect(completed.suggestions).toEqual([
      expect.objectContaining({
        field: "email",
        candidateValue: "mickenev1@gmail.com",
        source: "external_sender",
      }),
      expect.objectContaining({
        field: "phone",
        candidateValue: "515-555-0123",
        source: "conversation_analysis",
      }),
    ]);
    expect(completed.suggestions[0].reviewFingerprint)
      .not.toBe(pending.suggestions[0].reviewFingerprint);
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("suppresses only a conflicting person name and preserves safe email and phone", async () => {
    setup({
      analysis: analysis({
        name: "Jane Smith",
        email: "tom@northstarroofing.com",
        phone: "515-555-0123",
      }),
    });

    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    expect(view).toMatchObject({
      state: "PARTIAL",
      ambiguous: true,
      ambiguousFields: ["name"],
    });
    expect(view.suggestions).toEqual([
      expect.objectContaining({
        field: "email",
        candidateValue: "tom@northstarroofing.com",
      }),
      expect.objectContaining({
        field: "phone",
        candidateValue: "515-555-0123",
      }),
    ]);
    expect(view.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "name" }),
    ]));
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("suppresses a conflicting email independently while retaining phone evidence", async () => {
    setup({
      analysis: analysis({
        name: "Tom Johnson",
        email: "jane@clientco.com",
        phone: "515-555-0123",
      }),
    });

    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    expect(view).toMatchObject({
      state: "PARTIAL",
      ambiguous: true,
      ambiguousFields: ["email"],
    });
    expect(view.suggestions).toEqual([
      expect.objectContaining({ field: "name" }),
      expect.objectContaining({ field: "phone" }),
    ]);
    expect(view.suggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "email" }),
    ]));
  });

  it("prefers deterministic evidence when analysis agrees after normalization", async () => {
    setup({
      analysis: analysis({
        name: "tom johnson",
        email: "TOM@NORTHSTARROOFING.COM",
      }),
    });

    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    expect(byField(view.suggestions, "name").source).toBe("external_sender");
    expect(byField(view.suggestions, "email").source).toBe("external_sender");
  });
});

describe("reviewed contact extraction mutations", () => {
  it("applies a reviewed blank-field suggestion and records one grouped contact activity", async () => {
    const state = setup({ lead: lead({ name: "Tom Johnson" }) });
    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );
    const suggestion = byField(view.suggestions, "email");
    mocks.client.conversation.findFirst.mockClear();

    const result = await applyConversationContactSuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email",
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
      replace: false,
    });
    expect(mocks.client.conversation.findFirst).toHaveBeenCalledOnce();

    expect(result).toMatchObject({
      changed: true,
      outcome: "APPLIED",
      appliedFields: ["email"],
      skippedFields: [],
      contactView: {
        lead: { email: "tom@northstarroofing.com" },
        state: "NO_SUGGESTIONS",
      },
    });
    expect(state.lead?.email).toBe("tom@northstarroofing.com");
    expect(result.contactView.evaluatedAt).toBe(
      state.lead?.updatedAt.toISOString(),
    );
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
    expect(mocks.recordActivity).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({
        ownerId: "owner-a",
        leadId: "lead-a",
        conversationId: "conversation-a",
        type: "CONTACT_INFO_CHANGED",
        actorType: "USER",
        source: "INBOX",
        metadata: {
          email: { from: null, to: "tom@northstarroofing.com" },
        },
        idempotencyKey: expect.stringMatching(
          /^contact-extraction:conversation-a:lead-a:[a-f0-9]{64}$/,
        ),
      }),
    );
  });

  it("requires explicit replacement for a populated conflict", async () => {
    const state = setup({
      lead: lead({ name: "Tom Johnson", email: "manual@clientco.com" }),
    });
    const suggestion = byField((await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).suggestions, "email");

    const withoutReplace = await applyConversationContactSuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email",
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
      replace: false,
    });
    expect(withoutReplace).toMatchObject({
      changed: false,
      outcome: "STALE",
      skippedFields: ["email"],
    });
    expect(state.lead?.email).toBe("manual@clientco.com");

    const replaced = await applyConversationContactSuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email",
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
      replace: true,
    });
    expect(replaced).toMatchObject({
      changed: true,
      outcome: "APPLIED",
      appliedFields: ["email"],
    });
    expect(state.lead?.email).toBe("tom@northstarroofing.com");
  });

  it("applies all safe blank fields, skips conflicts, and groups activity", async () => {
    const state = setup({
      lead: lead({ name: "Manual Name" }),
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({
        name: "Jordan Customer",
        email: "jordan@clientco.com",
        phone: "(515) 555-0100",
      }),
    });
    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );
    mocks.client.conversation.findFirst.mockClear();

    const result = await applyAvailableConversationContactSuggestions({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      reviewFingerprints: view.suggestions.map(
        (suggestion) => suggestion.reviewFingerprint,
      ),
    });
    expect(mocks.client.conversation.findFirst).toHaveBeenCalledOnce();

    expect(result).toMatchObject({
      changed: true,
      outcome: "PARTIAL",
      appliedFields: ["email", "phone"],
      skippedFields: ["name"],
      contactView: {
        lead: {
          name: "Manual Name",
          email: "jordan@clientco.com",
          phone: "(515) 555-0100",
        },
      },
    });
    expect(state.lead?.name).toBe("Manual Name");
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
    expect(mocks.recordActivity.mock.calls[0][1].metadata).toEqual({
      email: { from: null, to: "jordan@clientco.com" },
      phone: { from: null, to: "(515) 555-0100" },
    });
  });

  it("never uses Apply all to replace a populated conflict", async () => {
    const state = setup({
      lead: lead({
        name: "Tom Johnson",
        email: "manual@clientco.com",
      }),
    });
    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    const result = await applyAvailableConversationContactSuggestions({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      reviewFingerprints: view.suggestions.map(
        (suggestion) => suggestion.reviewFingerprint,
      ),
    });

    expect(result).toMatchObject({
      changed: false,
      outcome: "PARTIAL",
      appliedFields: [],
      skippedFields: ["email"],
    });
    expect(state.lead?.email).toBe("manual@clientco.com");
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("partially applies still-current fields after an intervening manual edit", async () => {
    const state = setup({
      lead: lead({ name: "Jordan Customer" }),
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({
        email: "jordan@clientco.com",
        phone: "515-555-0100",
      }),
    });
    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );
    state.manualEdit({ phone: "515-555-9999" });

    const result = await applyAvailableConversationContactSuggestions({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      reviewFingerprints: view.suggestions.map(
        (suggestion) => suggestion.reviewFingerprint,
      ),
    });

    expect(result).toMatchObject({
      changed: true,
      outcome: "PARTIAL",
      appliedFields: ["email"],
      skippedFields: ["phone"],
    });
    expect(state.lead).toMatchObject({
      email: "jordan@clientco.com",
      phone: "515-555-9999",
    });
  });

  it("reports a partial result when another reviewer already applied one selected field", async () => {
    const state = setup({
      lead: lead({ name: "Jordan Customer" }),
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({
        email: "jordan@clientco.com",
        phone: "515-555-0100",
      }),
    });
    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );
    state.manualEdit({ email: "jordan@clientco.com" });

    const result = await applyAvailableConversationContactSuggestions({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      reviewFingerprints: view.suggestions.map(
        (suggestion) => suggestion.reviewFingerprint,
      ),
    });

    expect(result).toMatchObject({
      changed: true,
      outcome: "PARTIAL",
      appliedFields: ["phone"],
      skippedFields: ["email"],
    });
    expect(state.lead).toMatchObject({
      email: "jordan@clientco.com",
      phone: "515-555-0100",
    });
  });

  it("rejects stale single-field review after a manual edit", async () => {
    const state = setup({ lead: lead({ name: "Tom Johnson" }) });
    const suggestion = byField((await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).suggestions, "email");
    state.manualEdit({ email: "manual@clientco.com" });

    const result = await applyConversationContactSuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email",
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
      replace: false,
    });

    expect(result).toMatchObject({ changed: false, outcome: "STALE" });
    expect(state.lead?.email).toBe("manual@clientco.com");
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("rejects stale Apply and Dismiss while reanalysis is active without writes", async () => {
    const state = setup({ lead: lead({ name: "Tom Johnson" }) });
    const suggestion = byField((await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).suggestions, "email");
    state.setAnalysis(analysis({
      name: "Tom Johnson",
      email: "tom@northstarroofing.com",
      phone: "515-555-0123",
    }, {
      status: "RUNNING",
      latestJobId: "job-new-analysis",
    }));
    state.setJobStatus("RUNNING");

    const applyResult = await applyConversationContactSuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email",
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
      replace: false,
    });
    const dismissResult = await dismissConversationContactSuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email",
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
    });

    expect(applyResult).toMatchObject({
      outcome: "STALE",
      changed: false,
      contactView: { state: "REFRESHING", refreshing: true },
    });
    expect(dismissResult).toMatchObject({
      outcome: "STALE",
      changed: false,
      contactView: { state: "REFRESHING", refreshing: true },
    });
    expect(state.lead?.email).toBeNull();
    expect(state.dismissals).toHaveLength(0);
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.client.conversationContactSuggestionDismissal.createMany)
      .not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("fails safely after detach, reassign, owner mismatch, unsupported fields, and CAS loss", async () => {
    const state = setup({ lead: lead({ name: "Tom Johnson" }) });
    const suggestion = byField((await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).suggestions, "email");
    const baseInput = {
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email" as const,
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
      replace: false,
    };

    state.detach();
    await expect(applyConversationContactSuggestion(baseInput)).resolves
      .toMatchObject({ outcome: "NOT_APPLICABLE", changed: false });

    state.attach(lead({ id: "lead-b", name: "Tom Johnson" }));
    await expect(applyConversationContactSuggestion(baseInput)).resolves
      .toMatchObject({ outcome: "STALE", changed: false });

    await expect(applyConversationContactSuggestion({
      ...baseInput,
      ownerId: "owner-b",
    })).resolves.toMatchObject({
      outcome: "NOT_APPLICABLE",
      changed: false,
    });

    state.attach(lead({ name: "Tom Johnson" }));
    await expect(applyConversationContactSuggestion({
      ...baseInput,
      field: "company" as ContactField,
    })).resolves.toMatchObject({ outcome: "STALE", changed: false });

    state.failUpdates();
    await expect(applyConversationContactSuggestion(baseInput)).resolves
      .toMatchObject({
        outcome: "STALE",
        changed: false,
        skippedFields: ["email"],
      });
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("keeps repeated and concurrent Apply idempotent", async () => {
    setup({ lead: lead({ name: "Tom Johnson" }) });
    const suggestion = byField((await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).suggestions, "email");
    const input = {
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email" as const,
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
      replace: false,
    };

    const [first, concurrent] = await Promise.all([
      applyConversationContactSuggestion(input),
      applyConversationContactSuggestion(input),
    ]);
    const repeated = await applyConversationContactSuggestion(input);

    expect([first, concurrent].filter((result) => result.changed)).toHaveLength(1);
    expect([first.outcome, concurrent.outcome]).toContain("APPLIED");
    expect(repeated).toMatchObject({ changed: false, outcome: "NO_CHANGE" });
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
  });

  it("keeps repeated and concurrent Apply all idempotent", async () => {
    setup({
      lead: lead({ name: "Jordan Customer" }),
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({
        email: "jordan@clientco.com",
        phone: "515-555-0100",
      }),
    });
    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );
    const input = {
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      reviewFingerprints: view.suggestions.map(
        (suggestion) => suggestion.reviewFingerprint,
      ),
    };

    const [first, concurrent] = await Promise.all([
      applyAvailableConversationContactSuggestions(input),
      applyAvailableConversationContactSuggestions(input),
    ]);
    const repeated =
      await applyAvailableConversationContactSuggestions(input);

    expect([first, concurrent].filter((result) => result.changed)).toHaveLength(1);
    expect([first.outcome, concurrent.outcome]).toContain("APPLIED");
    expect(repeated).toMatchObject({ changed: false, outcome: "NO_CHANGE" });
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
  });
});

describe("reviewed contact extraction dismissals and recheck", () => {
  it("keeps unrelated analysis changes dismissed and resurfaces materially changed evidence", async () => {
    const state = setup({
      lead: lead({ name: "Jordan Customer" }),
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({ email: "jordan@clientco.com" }),
    });
    const suggestion = byField((await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).suggestions, "email");
    const input = {
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email" as const,
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
    };
    mocks.client.conversation.findFirst.mockClear();

    const first = await dismissConversationContactSuggestion(input);
    expect(mocks.client.conversation.findFirst).toHaveBeenCalledOnce();
    const repeated = await dismissConversationContactSuggestion(input);
    const refreshed = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );

    expect(first).toMatchObject({ changed: true, outcome: "DISMISSED" });
    expect(repeated).toMatchObject({ changed: false, outcome: "DISMISSED" });
    expect(refreshed).toMatchObject({
      state: "NO_SUGGESTIONS",
      suggestions: [],
    });

    state.setAnalysis(analysis({ email: "jordan@clientco.com" }, {
      contentHash: "content-b",
    }));
    const unchanged = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );
    expect(unchanged).toMatchObject({
      state: "NO_SUGGESTIONS",
      suggestions: [],
    });

    state.setMessages([
      inbound("no-reply@notifications.com"),
      inbound("no-reply@notifications.com", 1),
    ]);
    state.setAnalysis(analysis({ email: "jordan@clientco.com" }, {
      contentHash: "content-c",
      sourceMessageCount: 2,
      evidenceMessageOrdinals: [2],
    }));
    const changed = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );
    expect(changed.state).toBe("READY");
    expect(byField(changed.suggestions, "email").evidenceFingerprint)
      .not.toBe(suggestion.evidenceFingerprint);
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("dismisses all current suggestions and repeats without creating activity", async () => {
    setup({
      lead: lead({ name: "Jordan Customer" }),
      messages: [inbound("no-reply@notifications.com")],
      analysis: analysis({
        email: "jordan@clientco.com",
        phone: "515-555-0100",
      }),
    });
    const view = await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    );
    const input = {
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      reviewFingerprints: view.suggestions.map(
        (suggestion) => suggestion.reviewFingerprint,
      ),
    };
    mocks.client.conversation.findFirst.mockClear();

    const first = await dismissAllConversationContactSuggestions(input);
    expect(mocks.client.conversation.findFirst).toHaveBeenCalledOnce();
    const repeated = await dismissAllConversationContactSuggestions(input);

    expect(first).toMatchObject({ changed: true, outcome: "DISMISSED" });
    expect(repeated).toMatchObject({ changed: false, outcome: "DISMISSED" });
    expect(repeated.contactView).toMatchObject({
      state: "NO_SUGGESTIONS",
      suggestions: [],
    });
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("rejects stale dismissal tokens and lead reassignment", async () => {
    const state = setup({ lead: lead({ name: "Tom Johnson" }) });
    const suggestion = byField((await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).suggestions, "email");
    state.manualEdit({ email: "manual@clientco.com" });

    await expect(dismissConversationContactSuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email",
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
    })).resolves.toMatchObject({ outcome: "STALE", changed: false });

    state.attach(lead({ id: "lead-b", name: "Tom Johnson" }));
    await expect(dismissConversationContactSuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email",
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
    })).resolves.toMatchObject({ outcome: "STALE", changed: false });
    expect(state.dismissals).toHaveLength(0);
  });

  it("makes Recheck read-only and returns no activity with or without suggestions", async () => {
    setup({ lead: lead({ name: "Tom Johnson" }) });
    const ready = await recheckConversationContactSuggestions(
      "owner-a",
      "conversation-a",
    );
    expect(ready).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      contactView: { state: "READY" },
    });

    setup({ messages: [] });
    const empty = await recheckConversationContactSuggestions(
      "owner-a",
      "conversation-a",
    );
    expect(empty).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      contactView: { state: "NO_SUGGESTIONS" },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("preserves a current dismissal during Recheck", async () => {
    setup({ lead: lead({ name: "Tom Johnson" }) });
    const suggestion = byField((await getConversationContactExtractionView(
      "owner-a",
      "conversation-a",
    )).suggestions, "email");
    await dismissConversationContactSuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      field: "email",
      evidenceFingerprint: suggestion.evidenceFingerprint,
      reviewFingerprint: suggestion.reviewFingerprint,
    });

    const result = await recheckConversationContactSuggestions(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      contactView: {
        state: "NO_SUGGESTIONS",
        suggestions: [],
      },
    });
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });
});
