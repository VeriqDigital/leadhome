import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    conversation: {
      findFirst: vi.fn(),
    },
    conversationCompanySuggestionDismissal: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    lead: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    leadActivity: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    message: {
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

import {
  applyConversationCompanySuggestion,
  detectAndApplyConversationCompany,
  dismissConversationCompanySuggestion,
  getConversationCompanyView,
  normalizeCompanyName,
  recheckConversationCompany,
} from "./company-detection-service";

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

type AssociationRow = {
  id: string;
  email: string | null;
  company: string | null;
  updatedAt: Date;
};

type AnalysisState = ReturnType<typeof analysis>;

function lead(overrides: Partial<LeadState> = {}): LeadState {
  return {
    id: "lead-a",
    userId: "owner-a",
    name: "Alex Customer",
    email: "alex@northstarroofing.com",
    phone: null,
    company: null,
    source: "MANUAL",
    status: "NEW",
    message: null,
    estimatedValue: null,
    nextFollowUpDate: null,
    updatedAt: new Date("2026-07-28T11:00:00.000Z"),
    ...overrides,
  };
}

function association(
  id: string,
  email: string,
  company: string,
  updatedAt = new Date("2026-07-28T12:00:00.000Z"),
): AssociationRow {
  return { id, email, company, updatedAt };
}

function inbound(
  sender: string | null,
  replyTo: string | null = null,
) {
  return {
    id: `message-${sender ?? "missing"}`,
    direction: "INBOUND",
    sender,
    replyTo,
  };
}

function outbound(sender: string) {
  return {
    id: `message-${sender}`,
    direction: "OUTBOUND",
    sender,
    replyTo: null,
  };
}

function analysis(
  company = "Northstar Roofing",
  options: {
    confidence?: number;
    evidenceMessageOrdinals?: number[];
    contentHash?: string;
    id?: string;
  } = {},
) {
  return {
    id: options.id ?? "analysis-a",
    status: "COMPLETED",
    contentHash: options.contentHash ?? "content-a",
    analysisVersion: "v1",
    completedAt: new Date("2026-07-28T13:00:00.000Z"),
    structuredData: {
      summary: "A customer asked about a roofing project.",
      company: {
        value: company,
        confidence: options.confidence ?? 0.9,
        evidenceMessageOrdinals:
          options.evidenceMessageOrdinals ?? [1],
      },
      contact: {
        name: null,
        email: null,
        phone: null,
        confidence: 0,
        evidenceMessageOrdinals: [],
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
  messages?: ReturnType<typeof inbound>[];
  associations?: AssociationRow[];
  analysis?: AnalysisState | null;
  accountAddress?: string;
  ownerEmail?: string;
  ownerMailboxAddresses?: string[];
} = {}) {
  const ownerId = options.ownerId ?? "owner-a";
  const conversationId = options.conversationId ?? "conversation-a";
  let currentLead = options.lead === undefined ? lead() : options.lead;
  let messages = options.messages ?? [
    inbound("Alex Customer <alex@northstarroofing.com>"),
  ];
  let associations = options.associations ?? [];
  let currentAnalysis = options.analysis ?? null;
  const dismissedFingerprints = new Set<string>();

  mocks.client.conversation.findFirst.mockImplementation(
    async (input: { where?: { id?: string; ownerId?: string } }) => {
      if (
        input.where?.id !== conversationId ||
        input.where?.ownerId !== ownerId
      ) {
        return null;
      }
      return {
        id: conversationId,
        owner: {
          email: options.ownerEmail ?? "owner@leadhome.test",
          communicationAccounts: (
            options.ownerMailboxAddresses ?? []
          ).map((address, index) => ({
            id: `account-${index}`,
            address,
          })),
        },
        account: {
          address: options.accountAddress ?? "inbox@leadhome.test",
        },
        lead: currentLead,
        analysis: currentAnalysis,
        messages,
      };
    },
  );
  mocks.client.lead.findMany.mockImplementation(
    async (input: { where?: { userId?: string } }) =>
      input.where?.userId === ownerId ? associations : [],
  );
  mocks.client.conversationCompanySuggestionDismissal.findMany
    .mockImplementation(
      async (input: {
        where?: {
          ownerId?: string;
          conversationId?: string;
          leadId?: string;
          evidenceFingerprint?: { in?: string[] };
        };
      }) => {
        if (
          input.where?.ownerId !== ownerId ||
          input.where?.conversationId !== conversationId ||
          input.where?.leadId !== currentLead?.id
        ) {
          return [];
        }
        return (input.where.evidenceFingerprint?.in ?? [])
          .filter((item) => dismissedFingerprints.has(item))
          .map((evidenceFingerprint) => ({ evidenceFingerprint }));
      },
    );
  mocks.client.conversationCompanySuggestionDismissal.createMany
    .mockImplementation(
      async (input: {
        data: Array<{ evidenceFingerprint: string }>;
      }) => {
        let count = 0;
        for (const row of input.data) {
          if (!dismissedFingerprints.has(row.evidenceFingerprint)) {
            dismissedFingerprints.add(row.evidenceFingerprint);
            count += 1;
          }
        }
        return { count };
      },
    );
  mocks.client.lead.updateMany.mockImplementation(
    async (input: {
      where: {
        id: string;
        userId: string;
        company: string | null;
        updatedAt: Date;
      };
      data: { company: string };
    }) => {
      if (
        !currentLead ||
        input.where.id !== currentLead.id ||
        input.where.userId !== ownerId ||
        input.where.company !== currentLead.company ||
        input.where.updatedAt.getTime() !== currentLead.updatedAt.getTime()
      ) {
        return { count: 0 };
      }
      currentLead = { ...currentLead, company: input.data.company };
      return { count: 1 };
    },
  );

  return {
    get lead() {
      return currentLead;
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
    setAssociations(nextAssociations: AssociationRow[]) {
      associations = nextAssociations;
    },
    setMessages(nextMessages: ReturnType<typeof inbound>[]) {
      messages = nextMessages;
    },
    dismissFingerprint(evidenceFingerprint: string) {
      dismissedFingerprints.add(evidenceFingerprint);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(
    async (
      operation: (client: typeof mocks.client) => Promise<unknown>,
    ) => operation(mocks.client),
  );
  mocks.recordActivity.mockResolvedValue({ created: true });
});

describe("automatic company detection", () => {
  it("auto-applies one unique owner-scoped domain association", async () => {
    setup({
      associations: [
        association("lead-known", "jane@northstarroofing.com", "Northstar Roofing"),
      ],
    });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: true,
      outcome: "APPLIED",
      companyView: {
        state: "COMPANY_PRESENT",
        lead: { id: "lead-a", company: "Northstar Roofing" },
        suggestion: null,
      },
    });
    expect(mocks.client.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "owner-a",
          id: { not: "lead-a" },
        }),
      }),
    );
    expect(mocks.client.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: "lead-a",
        userId: "owner-a",
        company: null,
        updatedAt: new Date("2026-07-28T11:00:00.000Z"),
        conversations: {
          some: {
            id: "conversation-a",
            ownerId: "owner-a",
            leadId: "lead-a",
          },
        },
      },
      data: { company: "Northstar Roofing" },
    });
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
    expect(mocks.recordActivity).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({
        ownerId: "owner-a",
        leadId: "lead-a",
        conversationId: "conversation-a",
        type: "COMPANY_CHANGED",
        actorType: "SYSTEM",
        source: "INBOX",
        idempotencyKey: expect.stringMatching(
          /^company-detection:conversation-a:lead-a:[a-f0-9]{64}$/,
        ),
      }),
    );
  });

  it("uses delimiter-aware domain filtering before the association cap", async () => {
    setup({
      associations: [
        association(
          "lead-known",
          "jane@northstarroofing.com",
          "Northstar Roofing",
        ),
      ],
    });
    mocks.client.lead.findMany.mockImplementationOnce(async (input) => {
      expect(input).toEqual(expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              email: {
                endsWith: "@northstarroofing.com",
                mode: "insensitive",
              },
            },
            {
              email: {
                endsWith: ".northstarroofing.com",
                mode: "insensitive",
              },
            },
          ],
        }),
        take: 201,
      }));
      return [
        association(
          "lead-known",
          "jane@northstarroofing.com",
          "Northstar Roofing",
        ),
      ];
    });

    await expect(
      detectAndApplyConversationCompany("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      changed: true,
      outcome: "APPLIED",
      companyView: {
        lead: { company: "Northstar Roofing" },
      },
    });
  });

  it("excludes the target lead from domain evidence", async () => {
    setup();

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "SUGGESTED",
        suggestion: {
          source: "BUSINESS_DOMAIN",
          automaticEligible: false,
        },
      },
    });
    expect(mocks.client.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: "lead-a" } }),
      }),
    );
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("never overwrites a nonempty company", async () => {
    setup({ lead: lead({ company: "Manual Company" }) });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "STALE",
      companyView: {
        state: "COMPANY_PRESENT",
        lead: { company: "Manual Company" },
      },
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("never treats an overlong legacy company value as blank", async () => {
    const legacyCompany = `Legacy ${"Company ".repeat(20)}`.trim();
    setup({ lead: lead({ company: legacyCompany }) });

    await expect(
      detectAndApplyConversationCompany("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      changed: false,
      outcome: "STALE",
      companyView: {
        state: "COMPANY_PRESENT",
        lead: { company: legacyCompany },
      },
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("uses a compare-and-set update so a concurrent manual edit wins", async () => {
    const state = setup({
      associations: [
        association("lead-known", "jane@northstarroofing.com", "Northstar Roofing"),
      ],
    });
    mocks.client.lead.updateMany.mockImplementationOnce(async () => {
      state.attach(lead({ company: "Manual Company" }));
      return { count: 0 };
    });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "STALE",
      companyView: {
        state: "COMPANY_PRESENT",
        lead: { company: "Manual Company" },
      },
    });
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("does not auto-apply conflicting company names for one domain", async () => {
    setup({
      associations: [
        association("lead-known-a", "jane@northstarroofing.com", "Northstar Roofing"),
        association("lead-known-b", "sam@northstarroofing.com", "Northstar Exteriors"),
      ],
    });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "NO_SUGGESTION",
        suggestion: null,
      },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when a same-domain company cannot be normalized safely", async () => {
    setup({
      associations: [
        association(
          "lead-known-a",
          "jane@northstarroofing.com",
          "Northstar Roofing",
        ),
        association(
          "lead-known-b",
          "sam@northstarroofing.com",
          `Legacy ${"Company ".repeat(20)}`.trim(),
        ),
      ],
    });

    await expect(
      detectAndApplyConversationCompany("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "NO_SUGGESTION",
        suggestion: null,
      },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("treats equivalent normalized company names as one association", async () => {
    setup({
      associations: [
        association(
          "lead-known-a",
          "jane@northstarroofing.com",
          "Northstar Roofing, Inc.",
          new Date("2026-07-27T12:00:00.000Z"),
        ),
        association(
          "lead-known-b",
          "sam@northstarroofing.com",
          "NORTHSTAR ROOFING INC",
          new Date("2026-07-28T12:00:00.000Z"),
        ),
      ],
    });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(normalizeCompanyName(" Northstar Roofing, Inc. ")).toBe(
      normalizeCompanyName("NORTHSTAR   ROOFING INC"),
    );
    expect(result).toMatchObject({
      changed: true,
      outcome: "APPLIED",
      companyView: {
        lead: { company: "NORTHSTAR ROOFING INC" },
      },
    });
  });

  it("scopes the conversation, company associations, and dismissals to one owner", async () => {
    setup();

    await getConversationCompanyView("owner-a", "conversation-a");

    expect(mocks.client.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conversation-a", ownerId: "owner-a" },
      }),
    );
    expect(mocks.client.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "owner-a" }),
      }),
    );
    expect(
      mocks.client.conversationCompanySuggestionDismissal.findMany,
    ).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-a",
        conversationId: "conversation-a",
        leadId: "lead-a",
        evidenceFingerprint: {
          in: [expect.stringMatching(/^[a-f0-9]{64}$/)],
        },
      },
      take: 1,
      select: { evidenceFingerprint: true },
    });

    await expect(
      getConversationCompanyView("owner-b", "conversation-a"),
    ).resolves.toMatchObject({
      state: "NOT_APPLICABLE",
      lead: null,
    });
  });

  it("treats a cross-owner attached lead as inaccessible", async () => {
    setup({
      lead: lead({ userId: "owner-b" }),
      associations: [
        association(
          "lead-known",
          "jane@northstarroofing.com",
          "Northstar Roofing",
        ),
      ],
    });

    await expect(
      getConversationCompanyView("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      state: "NOT_APPLICABLE",
      lead: null,
      suggestion: null,
      canRecheck: false,
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
    expect(
      mocks.client.conversationCompanySuggestionDismissal.findMany,
    ).not.toHaveBeenCalled();
  });

  it.each([
    "person@gmail.com",
    "person@googlemail.com",
    "person@outlook.com",
    "person@yahoo.com",
    "person@icloud.com",
    "person@proton.me",
  ])("does not derive a company from public provider %s", async (sender) => {
    setup({
      lead: lead({ email: sender }),
      messages: [inbound(sender)],
    });

    await expect(
      getConversationCompanyView("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      state: "NO_SUGGESTION",
      suggestion: null,
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
  });

  it("ignores the connected mailbox and owner identity", async () => {
    setup({
      messages: [
        inbound("LeadHome Inbox <inbox@leadhome.test>"),
        inbound("Owner <owner@leadhome.test>"),
      ],
    });

    await expect(
      getConversationCompanyView("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      state: "NO_SUGGESTION",
      suggestion: null,
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
  });

  it("does not use the connected mailbox as lead-domain fallback", async () => {
    setup({
      lead: lead({ email: "inbox@northstarroofing.com" }),
      accountAddress: "inbox@northstarroofing.com",
      ownerEmail: "owner@northstarroofing.com",
      messages: [inbound("External Person <person@gmail.com>")],
      associations: [
        association(
          "lead-known",
          "jane@northstarroofing.com",
          "Northstar Roofing",
        ),
      ],
    });

    await expect(
      detectAndApplyConversationCompany("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "NO_SUGGESTION",
        suggestion: null,
      },
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("excludes every bounded owner mailbox from identity and lead-domain fallback", async () => {
    setup({
      lead: lead({ email: "sales@northstarroofing.com" }),
      ownerMailboxAddresses: ["sales@northstarroofing.com"],
      messages: [
        inbound("Owner mailbox <sales@northstarroofing.com>"),
        inbound("External Person <person@gmail.com>"),
      ],
      associations: [
        association(
          "lead-known",
          "jane@northstarroofing.com",
          "Northstar Roofing",
        ),
      ],
    });

    await expect(
      detectAndApplyConversationCompany("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "NO_SUGGESTION",
        suggestion: null,
      },
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when the bounded owner mailbox lookup overflows", async () => {
    setup({
      ownerMailboxAddresses: Array.from(
        { length: 21 },
        (_, index) => `mailbox-${index}@owner-company.com`,
      ),
      associations: [
        association(
          "lead-known",
          "jane@northstarroofing.com",
          "Northstar Roofing",
        ),
      ],
    });

    await expect(
      detectAndApplyConversationCompany("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "NO_SUGGESTION",
        suggestion: null,
      },
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("does not use owner mailbox lead rows as company associations", async () => {
    setup({
      ownerEmail: "owner@northstarroofing.com",
      messages: [inbound("Customer <alex@northstarroofing.com>")],
      associations: [
        association(
          "lead-owner-mailbox",
          "owner@northstarroofing.com",
          "Owner Company",
        ),
      ],
    });

    await expect(
      detectAndApplyConversationCompany("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "SUGGESTED",
        suggestion: {
          source: "BUSINESS_DOMAIN",
          automaticEligible: false,
        },
      },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("ignores outbound-only, malformed, and missing participant addresses", async () => {
    setup({
      messages: [
        outbound("alex@northstarroofing.com"),
        inbound("not-an-email"),
        inbound(null),
      ] as ReturnType<typeof inbound>[],
    });

    await expect(
      getConversationCompanyView("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      state: "NO_SUGGESTION",
      suggestion: null,
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
  });

  it("uses the shared domain utility to normalize a sender subdomain", async () => {
    setup({
      messages: [inbound("alex@mail.northstarroofing.com")],
      associations: [
        association("lead-known", "jane@northstarroofing.com", "Northstar Roofing"),
      ],
    });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: true,
      companyView: {
        lead: { company: "Northstar Roofing" },
      },
    });
  });

  it("keeps structured analysis evidence suggestion-only", async () => {
    setup({
      lead: lead({ email: "alex@gmail.com" }),
      messages: [inbound("alex@gmail.com")],
      analysis: analysis("Acme Construction"),
    });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "SUGGESTED",
        suggestion: {
          value: "Acme Construction",
          source: "STRUCTURED_ANALYSIS",
          evidenceSummary: "Detected from conversation analysis",
          automaticEligible: false,
        },
      },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("allows cited structured evidence for a credible inbound name without an email", async () => {
    setup({
      lead: lead({ email: null }),
      messages: [inbound("Alex Customer")],
      associations: [
        association(
          "lead-known",
          "jane@northstarroofing.com",
          "Northstar Roofing",
        ),
      ],
      analysis: analysis("Acme Construction"),
    });

    await expect(
      detectAndApplyConversationCompany("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "SUGGESTED",
        suggestion: {
          value: "Acme Construction",
          source: "STRUCTURED_ANALYSIS",
          automaticEligible: false,
        },
      },
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("does not auto-apply a domain association that conflicts with structured evidence", async () => {
    setup({
      associations: [
        association("lead-known", "jane@northstarroofing.com", "Northstar Roofing"),
      ],
      analysis: analysis("Acme Construction"),
    });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "SUGGESTED",
        suggestion: {
          value: "Northstar Roofing",
          source: "DOMAIN_ASSOCIATION",
          automaticEligible: false,
        },
      },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("does not auto-apply when sender and reply-to domains conflict", async () => {
    setup({
      lead: lead({ email: "alex@agency.com" }),
      messages: [
        inbound("Agent <agent@agency.com>", "Customer <owner@client.com>"),
      ],
      associations: [
        association("lead-known", "jane@agency.com", "Agency Partners"),
      ],
    });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "SUGGESTED",
        suggestion: {
          value: "Agency Partners",
          source: "DOMAIN_ASSOCIATION",
          automaticEligible: false,
        },
      },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("does not auto-apply when the attached lead email conflicts with the sender domain", async () => {
    setup({
      lead: lead({ email: "alex@client.com" }),
      messages: [inbound("Agent <agent@agency.com>")],
      associations: [
        association("lead-known", "jane@agency.com", "Agency Partners"),
      ],
    });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "SUGGESTED",
        suggestion: {
          value: "Agency Partners",
          source: "DOMAIN_ASSOCIATION",
          automaticEligible: false,
        },
      },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("does not let a reserved participant domain unlock lead-email fallback", async () => {
    setup({
      lead: lead({ email: "alex@northstarroofing.com" }),
      messages: [inbound("Person <person@host.invalid>")],
      associations: [
        association("lead-known", "jane@northstarroofing.com", "Northstar Roofing"),
      ],
    });

    await expect(
      detectAndApplyConversationCompany("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "NO_SUGGESTION",
        suggestion: null,
      },
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a human-readable business-domain name suggestion-only", async () => {
    setup({
      lead: lead({ email: null }),
      messages: [inbound("alex@northstar-roofing.com")],
    });

    const result = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "SUGGESTED",
        suggestion: {
          value: "Northstar Roofing",
          source: "BUSINESS_DOMAIN",
          automaticEligible: false,
        },
      },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
  });

  it("keeps repeated evaluation and automatic application idempotent", async () => {
    setup({
      associations: [
        association("lead-known", "jane@northstarroofing.com", "Northstar Roofing"),
      ],
    });

    const firstView = await getConversationCompanyView(
      "owner-a",
      "conversation-a",
    );
    const secondView = await getConversationCompanyView(
      "owner-a",
      "conversation-a",
    );
    expect(secondView.suggestion?.evidenceFingerprint).toBe(
      firstView.suggestion?.evidenceFingerprint,
    );
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();

    const firstApply = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );
    const repeatedApply = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(firstApply.changed).toBe(true);
    expect(repeatedApply).toMatchObject({
      changed: false,
      outcome: "STALE",
      companyView: { state: "COMPANY_PRESENT" },
    });
    expect(mocks.client.lead.updateMany).toHaveBeenCalledOnce();
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
  });

  it("records a later real reapplication after a manual clear", async () => {
    const state = setup({
      associations: [
        association(
          "lead-known",
          "jane@northstarroofing.com",
          "Northstar Roofing",
        ),
      ],
    });

    await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );
    const firstIdempotencyKey =
      mocks.recordActivity.mock.calls[0][1].idempotencyKey;
    state.attach({
      ...state.lead!,
      company: null,
      updatedAt: new Date("2026-07-29T11:00:00.000Z"),
    });

    const reapplied = await detectAndApplyConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(reapplied).toMatchObject({
      changed: true,
      outcome: "APPLIED",
      companyView: {
        state: "COMPANY_PRESENT",
        lead: { company: "Northstar Roofing" },
      },
    });
    expect(mocks.recordActivity).toHaveBeenCalledTimes(2);
    expect(mocks.recordActivity.mock.calls[1][1].idempotencyKey)
      .not.toBe(firstIdempotencyKey);
  });

  it("returns no suggestion when there is no credible external evidence", async () => {
    setup({ messages: [] });

    await expect(
      getConversationCompanyView("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      state: "NO_SUGGESTION",
      suggestion: null,
      canRecheck: true,
    });
    expect(mocks.client.lead.findMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });
});

describe("company suggestion mutations and dismissals", () => {
  it("fails safely if the conversation is detached before Apply", async () => {
    const state = setup();
    const suggestion = (
      await getConversationCompanyView("owner-a", "conversation-a")
    ).suggestion!;
    state.detach();

    const result = await applyConversationCompanySuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      evidenceFingerprint: suggestion.evidenceFingerprint,
    });

    expect(result).toMatchObject({
      changed: false,
      outcome: "NOT_APPLICABLE",
      companyView: { state: "NOT_APPLICABLE" },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("rejects a stale expected lead after the conversation is reattached", async () => {
    const state = setup();
    const suggestion = (
      await getConversationCompanyView("owner-a", "conversation-a")
    ).suggestion!;
    state.attach(lead({ id: "lead-b", name: "Other Lead" }));

    const result = await applyConversationCompanySuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      evidenceFingerprint: suggestion.evidenceFingerprint,
    });

    expect(result).toMatchObject({
      changed: false,
      outcome: "STALE",
      companyView: { lead: { id: "lead-b" } },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("persists a dismissal across refresh and makes repeated dismissal idempotent", async () => {
    setup();
    const suggestion = (
      await getConversationCompanyView("owner-a", "conversation-a")
    ).suggestion!;
    const input = {
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      evidenceFingerprint: suggestion.evidenceFingerprint,
    };

    const dismissed = await dismissConversationCompanySuggestion(input);
    const repeated = await dismissConversationCompanySuggestion(input);
    const refreshed = await getConversationCompanyView(
      "owner-a",
      "conversation-a",
    );

    expect(dismissed).toMatchObject({
      changed: true,
      outcome: "DISMISSED",
      companyView: { state: "NO_SUGGESTION", suggestion: null },
    });
    expect(repeated).toMatchObject({
      changed: false,
      outcome: "DISMISSED",
    });
    expect(refreshed).toMatchObject({
      state: "NO_SUGGESTION",
      suggestion: null,
    });
    expect(
      mocks.client.conversationCompanySuggestionDismissal.createMany,
    ).toHaveBeenCalledTimes(2);
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("allows materially changed analysis evidence to produce a new candidate", async () => {
    const state = setup({
      lead: lead({ email: "alex@gmail.com" }),
      messages: [inbound("alex@gmail.com")],
      analysis: analysis("Acme Construction", { contentHash: "content-a" }),
    });
    const initial = (
      await getConversationCompanyView("owner-a", "conversation-a")
    ).suggestion!;
    await dismissConversationCompanySuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      evidenceFingerprint: initial.evidenceFingerprint,
    });

    state.setAnalysis(
      analysis("Acme Construction", { contentHash: "content-b" }),
    );
    const changed = await getConversationCompanyView(
      "owner-a",
      "conversation-a",
    );

    expect(changed).toMatchObject({
      state: "SUGGESTED",
      suggestion: {
        value: "Acme Construction",
        source: "STRUCTURED_ANALYSIS",
      },
    });
    expect(changed.suggestion?.evidenceFingerprint).not.toBe(
      initial.evidenceFingerprint,
    );
  });

  it("keeps dismissal stable across non-material analysis variance", async () => {
    const state = setup({
      lead: lead({ email: "alex@gmail.com" }),
      messages: [inbound("alex@gmail.com")],
      analysis: analysis("Acme Construction", {
        id: "analysis-a",
        contentHash: "content-stable",
        confidence: 0.82,
        evidenceMessageOrdinals: [1, 2],
      }),
    });
    const initial = (
      await getConversationCompanyView("owner-a", "conversation-a")
    ).suggestion!;
    await dismissConversationCompanySuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      evidenceFingerprint: initial.evidenceFingerprint,
    });

    state.setAnalysis(analysis("Acme Construction", {
      id: "analysis-b",
      contentHash: "content-stable",
      confidence: 0.83,
      evidenceMessageOrdinals: [2, 1, 2],
    }));

    await expect(
      getConversationCompanyView("owner-a", "conversation-a"),
    ).resolves.toMatchObject({
      state: "NO_SUGGESTION",
      suggestion: null,
    });
  });

  it("shows a different candidate after the current candidate is dismissed", async () => {
    setup({
      analysis: analysis("Acme Construction"),
    });
    const initial = await getConversationCompanyView(
      "owner-a",
      "conversation-a",
    );
    expect(initial.suggestion).toMatchObject({
      value: "Acme Construction",
      source: "STRUCTURED_ANALYSIS",
    });

    const result = await dismissConversationCompanySuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      evidenceFingerprint: initial.suggestion!.evidenceFingerprint,
    });

    expect(result).toMatchObject({
      changed: true,
      companyView: {
        state: "SUGGESTED",
        suggestion: {
          value: "Northstar Roofing",
          source: "BUSINESS_DOMAIN",
        },
      },
    });
  });

  it("preserves a dismissal during Recheck and creates no activity", async () => {
    setup();
    const suggestion = (
      await getConversationCompanyView("owner-a", "conversation-a")
    ).suggestion!;
    await dismissConversationCompanySuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      evidenceFingerprint: suggestion.evidenceFingerprint,
    });

    const result = await recheckConversationCompany(
      "owner-a",
      "conversation-a",
    );

    expect(result).toMatchObject({
      changed: false,
      outcome: "NO_CHANGE",
      companyView: {
        state: "NO_SUGGESTION",
        suggestion: null,
      },
    });
    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("does not create activity for suggestion, dismissal, or recheck", async () => {
    setup({
      lead: lead({ email: "alex@gmail.com" }),
      messages: [inbound("alex@gmail.com")],
      analysis: analysis("Acme Construction"),
    });
    const view = await getConversationCompanyView(
      "owner-a",
      "conversation-a",
    );
    await dismissConversationCompanySuggestion({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      expectedLeadId: "lead-a",
      evidenceFingerprint: view.suggestion!.evidenceFingerprint,
    });
    await recheckConversationCompany("owner-a", "conversation-a");

    expect(mocks.client.lead.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });
});
