/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  conversation: null as any,
  leads: [] as any[],
  activities: [] as any[],
  messagesUnchanged: [] as any[],
  sequence: 0,
}));

const analysis = vi.hoisted(() => ({
  enqueue: vi.fn(),
}));

const database = vi.hoisted(() => ({
  conversation: {
    findFirst: vi.fn(async ({ where }: any) => {
      if (
        !state.conversation ||
        state.conversation.id !== where.id ||
        state.conversation.ownerId !== where.ownerId
      ) return null;
      return state.conversation;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      if (
        !state.conversation ||
        state.conversation.id !== where.id ||
        state.conversation.ownerId !== where.ownerId ||
        state.conversation.leadId !== null
      ) return { count: 0 };
      state.conversation = { ...state.conversation, ...data };
      return { count: 1 };
    }),
  },
  lead: {
    findFirst: vi.fn(async ({ where }: any) =>
      state.leads.find(
        (lead) =>
          lead.userId === where.userId &&
          lead.email?.toLowerCase() === where.email?.equals?.toLowerCase(),
      ) ?? null),
    create: vi.fn(async ({ data }: any) => {
      const lead = { id: `lead-${++state.sequence}`, ...data };
      state.leads.push(lead);
      return { id: lead.id };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const index = state.leads.findIndex((lead) => lead.id === where.id);
      state.leads[index] = { ...state.leads[index], ...data };
      return state.leads[index];
    }),
  },
  leadActivity: {
    create: vi.fn(async ({ data }: any) => {
      state.activities.push(data);
      return { id: `activity-${state.activities.length}` };
    }),
  },
  inboundSubmission: {
    findFirst: vi.fn(async () => null),
  },
  $transaction: vi.fn(
    async (operation: (tx: any) => unknown) => operation(database),
  ),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: database,
}));
vi.mock("@/lib/ai/conversation-analysis/job-service", () => ({
  enqueueConversationAnalysisAfterLeadLink: analysis.enqueue,
}));

const {
  DuplicateLeadConfirmationRequired,
  createLeadFromConversation,
  getConversationLeadPrefill,
  participantIdentity,
} = await import("./conversation-lead-service");

const lead = {
  name: "Jane Doe",
  email: "jane@example.com",
  phone: null,
  company: null,
  source: "GMAIL" as const,
  status: "NEW" as const,
  message: "Hello",
  estimatedValue: null,
  nextFollowUpDate: null,
};

beforeEach(() => {
  state.leads.length = 0;
  state.activities.length = 0;
  state.sequence = 0;
  state.messagesUnchanged = [{ id: "message-a", bodyText: "Hello" }];
  state.conversation = {
    id: "conversation-a",
    ownerId: "owner-a",
    leadId: null,
    subject: null,
    provider: "GMAIL",
    messages: [{
      sender: '"Jane Doe" <jane@example.com>',
      replyTo: null,
      bodyText: null,
      bodyHtml: "<p>Hello <strong>there</strong></p>",
      sourceSystem: null,
      externalSubmissionId: null,
    }],
  };
  vi.clearAllMocks();
  analysis.enqueue.mockResolvedValue(undefined);
});

describe("create lead from conversation", () => {
  it("extracts safe display names and normalized sender email", () => {
    expect(participantIdentity('"Jane Doe" <JANE@example.com>')).toEqual({
      name: "Jane Doe",
      email: "jane@example.com",
    });
    expect(participantIdentity("jane@example.com")).toEqual({
      name: "New lead",
      email: "jane@example.com",
    });
  });

  it("prefills HTML-only messages with a short plain-text excerpt", async () => {
    const result = await getConversationLeadPrefill("owner-a", "conversation-a");
    expect(result?.lead).toEqual(expect.objectContaining({
      name: "Jane Doe",
      email: "jane@example.com",
      message: "Hello there",
      source: "GMAIL",
    }));
  });

  it("owner-scopes prefill and creation", async () => {
    await expect(
      getConversationLeadPrefill("owner-b", "conversation-a"),
    ).resolves.toBeNull();
    await expect(createLeadFromConversation({
      ownerId: "owner-b",
      conversationId: "conversation-a",
      lead,
    })).rejects.toThrow("Conversation not found");
  });

  it("atomically creates, attaches, classifies, and records understandable activity", async () => {
    const before = structuredClone(state.messagesUnchanged);
    const result = await createLeadFromConversation({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      lead,
    });
    expect(result.created).toBe(true);
    expect(state.conversation).toEqual(expect.objectContaining({
      leadId: result.leadId,
      reviewState: "MATCHED",
      classification: "LEAD",
    }));
    expect(state.activities.map((item) => item.type)).toEqual([
      "LEAD_CREATED",
      "CONVERSATION_LINKED",
    ]);
    expect(state.messagesUnchanged).toEqual(before);
    expect(analysis.enqueue).toHaveBeenCalledTimes(1);
    expect(analysis.enqueue).toHaveBeenCalledWith(
      "owner-a",
      "conversation-a",
    );
    expect(database.lead.update.mock.invocationCallOrder[0]).toBeLessThan(
      analysis.enqueue.mock.invocationCallOrder[0],
    );
  });

  it("requires an explicit choice for duplicate email and can attach existing", async () => {
    state.leads.push({
      id: "lead-existing",
      userId: "owner-a",
      email: "jane@example.com",
      name: "Jane",
    });
    await expect(createLeadFromConversation({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      lead,
    })).rejects.toBeInstanceOf(DuplicateLeadConfirmationRequired);

    const result = await createLeadFromConversation({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      lead,
      duplicateChoice: "attach-existing",
      duplicateLeadId: "lead-existing",
    });
    expect(result).toEqual({ leadId: "lead-existing", created: false });
    expect(state.leads).toHaveLength(1);
    expect(analysis.enqueue).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue when the conversation is already attached", async () => {
    state.conversation.leadId = "lead-existing";

    await expect(
      createLeadFromConversation({
        ownerId: "owner-a",
        conversationId: "conversation-a",
        lead,
      }),
    ).rejects.toThrow("Conversation is already attached");

    expect(analysis.enqueue).not.toHaveBeenCalled();
  });
});
