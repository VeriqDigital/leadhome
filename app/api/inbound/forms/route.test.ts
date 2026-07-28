import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret } from "@/lib/inbound-crypto";

const mocks = vi.hoisted(() => ({
  findSource: vi.fn(),
  upsertRate: vi.fn(),
  deleteRates: vi.fn(),
  createLead: vi.fn(),
  findLeads: vi.fn(),
  createActivities: vi.fn(),
  createSubmission: vi.fn(),
  findSubmission: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inboundSource: { findUnique: mocks.findSource },
    inboundRateLimit: { upsert: mocks.upsertRate, deleteMany: mocks.deleteRates },
    inboundSubmission: { findUnique: mocks.findSubmission },
    lead: { create: mocks.createLead },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "./route";

const token1 = "a".repeat(43);
const token2 = "b".repeat(43);
const sources = [
  {
    id: "source-1",
    name: "Veriq",
    userId: "owner-1",
    tokenHash: hashSecret(token1),
    isActive: true,
  },
  {
    id: "source-2",
    name: "Second site",
    userId: "owner-2",
    tokenHash: hashSecret(token2),
    isActive: true,
  },
];

const submissions = new Map<string, string>();
const committedLeadIds: string[] = [];
const committedActivities: object[] = [];
let leadSequence = 0;

function request(
  payload: object,
  { token = token1, idempotencyKey }: { token?: string; idempotencyKey?: string } = {},
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "x-forwarded-for": "203.0.113.5",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  return new Request("http://localhost/api/inbound/forms", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function submissionKey(sourceId: string, idempotencyHash: string) {
  return `${sourceId}:${idempotencyHash}`;
}

beforeEach(() => {
  submissions.clear();
  committedLeadIds.length = 0;
  committedActivities.length = 0;
  leadSequence = 0;
  mocks.findSource.mockImplementation(({ where: { tokenHash } }) =>
    Promise.resolve(sources.find((source) => source.tokenHash === tokenHash) ?? null),
  );
  mocks.upsertRate.mockResolvedValue({ count: 1 });
  mocks.deleteRates.mockResolvedValue({ count: 0 });
  mocks.createLead.mockImplementation(async () => {
    return { id: `lead-${++leadSequence}` };
  });
  mocks.findLeads.mockResolvedValue([]);
  mocks.createActivities.mockImplementation(async ({ data }) => ({
    count: data.length,
  }));
  mocks.findSubmission.mockImplementation(
    ({ where: { sourceId_idempotencyHash: key } }) => {
      const leadId = submissions.get(submissionKey(key.sourceId, key.idempotencyHash));
      return Promise.resolve(leadId ? { leadId } : null);
    },
  );
  mocks.createSubmission.mockImplementation(async ({ data }) => {
    const key = submissionKey(data.sourceId, data.idempotencyHash);
    if (submissions.has(key)) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["sourceId", "idempotencyHash"] },
      });
    }
    submissions.set(key, data.leadId);
    return { id: `submission-${data.leadId}` };
  });
  mocks.transaction.mockImplementation(async (operation) => {
    const pendingLeads: { id: string; userId: string }[] = [];
    const pendingActivities: object[] = [];
    const result = await operation({
      lead: {
        create: async (input: { data: { userId: string } }) => {
          const lead = await mocks.createLead(input);
          pendingLeads.push({ id: lead.id, userId: input.data.userId });
          return lead;
        },
        findMany: async (input: {
          where: { id: { in: string[] }; userId: string };
        }) => {
          mocks.findLeads(input);
          return pendingLeads
            .filter(
              (lead) =>
                lead.userId === input.where.userId &&
                input.where.id.in.includes(lead.id),
            )
            .map(({ id }) => ({ id }));
        },
      },
      leadActivity: {
        createMany: async (input: {
          data: object[];
          skipDuplicates: boolean;
        }) => {
          const created = await mocks.createActivities(input);
          pendingActivities.push(...input.data);
          return created;
        },
      },
      inboundSubmission: { create: mocks.createSubmission },
    });
    committedLeadIds.push(...pendingLeads.map(({ id }) => id));
    committedActivities.push(...pendingActivities);
    return result;
  });
});

describe("POST /api/inbound/forms", () => {
  it("creates one lead for the first keyed request", async () => {
    const response = await POST(
      request({ name: "Jane", email: "jane@example.com" }, { idempotencyKey: "contact-12345" }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      success: true,
      id: "lead-1",
      deduplicated: false,
    });
    expect(committedLeadIds).toEqual(["lead-1"]);
    expect(submissions).toHaveLength(1);
    expect(committedActivities).toEqual([
      expect.objectContaining({
        type: "WEBSITE_SUBMISSION_RECEIVED",
        description: "Submission received from Veriq",
        userId: "owner-1",
        actorType: "CONTACT",
        source: "WEBSITE",
        idempotencyKey: `website:source-1:${hashSecret("contact-12345")}`,
      }),
    ]);
    expect(mocks.createActivities).toHaveBeenCalledWith({
      data: [expect.objectContaining({ leadId: "lead-1" })],
      skipDuplicates: true,
    });
  });

  it("deduplicates a repeated key from the same source", async () => {
    const first = await POST(request({ name: "Jane" }, { idempotencyKey: "contact-12345" }));
    const repeated = await POST(request({ name: "Jane again" }, { idempotencyKey: "contact-12345" }));
    const firstBody = await first.json();

    expect(repeated.status).toBe(200);
    await expect(repeated.json()).resolves.toEqual({
      success: true,
      id: firstBody.id,
      deduplicated: true,
    });
    expect(committedLeadIds).toHaveLength(1);
    expect(committedActivities).toHaveLength(1);
  });

  it("allows the same key for a different authenticated source", async () => {
    const first = await POST(request({ name: "Jane" }, { idempotencyKey: "contact-12345" }));
    const second = await POST(
      request({ name: "John" }, { token: token2, idempotencyKey: "contact-12345" }),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(committedLeadIds).toHaveLength(2);
    expect(submissions).toHaveLength(2);
  });

  it("creates another lead for a different key from the same source", async () => {
    await POST(request({ name: "Jane" }, { idempotencyKey: "contact-12345" }));
    await POST(request({ name: "Jane" }, { idempotencyKey: "contact-67890" }));

    expect(committedLeadIds).toHaveLength(2);
    expect(submissions).toHaveLength(2);
  });

  it("commits only one lead for concurrent duplicate requests", async () => {
    mocks.findSubmission.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const [first, duplicate] = await Promise.all([
      POST(request({ name: "Jane" }, { idempotencyKey: "concurrent-12345" })),
      POST(request({ name: "Jane" }, { idempotencyKey: "concurrent-12345" })),
    ]);
    const responses = await Promise.all([first.json(), duplicate.json()]);

    expect([first.status, duplicate.status].sort()).toEqual([200, 201]);
    expect(responses).toContainEqual({
      success: true,
      id: committedLeadIds[0],
      deduplicated: false,
    });
    expect(responses).toContainEqual({
      success: true,
      id: committedLeadIds[0],
      deduplicated: true,
    });
    expect(committedLeadIds).toHaveLength(1);
    expect(submissions).toHaveLength(1);
    expect(committedActivities).toHaveLength(1);
  });

  it("preserves token authentication and source ownership", async () => {
    const unauthorized = await POST(request({ name: "Jane" }, { token: "c".repeat(43) }));
    expect(unauthorized.status).toBe(401);

    await POST(request({
      name: "Jane",
      userId: "attacker",
      sourceId: "source-2",
      leadId: "other-lead",
      activityType: "STATUS_CHANGED",
      activityTitle: "Injected",
    }));
    expect(mocks.createLead).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "owner-1",
        source: "WEBSITE",
        status: "NEW",
      }),
    }));
    expect(committedActivities).toEqual([
      expect.objectContaining({
        userId: "owner-1",
        type: "WEBSITE_SUBMISSION_RECEIVED",
        actorType: "CONTACT",
        source: "WEBSITE",
        title: "Website lead created",
      }),
    ]);
  });

  it("rejects missing tokens, disabled sources, and invalid payloads", async () => {
    const missingToken = await POST(
      new Request("http://localhost/api/inbound/forms", { method: "POST", body: "{}" }),
    );
    expect(missingToken.status).toBe(401);

    mocks.findSource.mockResolvedValueOnce({ ...sources[0], isActive: false });
    expect((await POST(request({ name: "Jane" }))).status).toBe(401);

    expect((await POST(request({ name: "", email: "not-an-email" }))).status).toBe(400);
  });
});
