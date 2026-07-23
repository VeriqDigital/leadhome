import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret } from "@/lib/inbound-crypto";

const mocks = vi.hoisted(() => ({
  findSource: vi.fn(),
  upsertRate: vi.fn(),
  deleteRates: vi.fn(),
  createLead: vi.fn(),
  findSubmission: vi.fn(),
  deleteSubmissions: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inboundSource: { findUnique: mocks.findSource },
    inboundRateLimit: { upsert: mocks.upsertRate, deleteMany: mocks.deleteRates },
    inboundSubmission: {
      findUnique: mocks.findSubmission,
      deleteMany: mocks.deleteSubmissions,
    },
    lead: { create: mocks.createLead },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "./route";

const token = "a".repeat(43);
const source = {
  id: "source-1",
  userId: "owner-1",
  tokenHash: hashSecret(token),
  isActive: true,
};

function request(payload: object, suppliedToken = token) {
  return new Request("http://localhost/api/inbound/forms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${suppliedToken}`,
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.5",
    },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  mocks.findSource.mockResolvedValue(source);
  mocks.upsertRate.mockResolvedValue({ count: 1 });
  mocks.deleteRates.mockResolvedValue({ count: 0 });
  mocks.deleteSubmissions.mockResolvedValue({ count: 0 });
  mocks.createLead.mockResolvedValue({ id: "lead-1" });
  mocks.findSubmission.mockResolvedValue(null);
});

describe("POST /api/inbound/forms", () => {
  it("ingests a valid lead", async () => {
    const response = await POST(request({ name: "Jane", email: "jane@example.com" }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ success: true, id: "lead-1" });
  });

  it("rejects a missing token", async () => {
    const response = await POST(new Request("http://localhost/api/inbound/forms", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    expect(mocks.findSource).not.toHaveBeenCalled();
  });

  it("rejects an invalid token with the generic response", async () => {
    mocks.findSource.mockResolvedValue(null);
    const response = await POST(request({ name: "Jane" }, "b".repeat(43)));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ success: false, error: "Unauthorized" });
  });

  it("rejects a disabled source", async () => {
    mocks.findSource.mockResolvedValue({ ...source, isActive: false });
    expect((await POST(request({ name: "Jane" }))).status).toBe(401);
  });

  it("rejects an invalid payload", async () => {
    expect((await POST(request({ name: "", email: "not-an-email" }))).status).toBe(400);
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it("forces source and status instead of accepting overrides", async () => {
    await POST(request({ name: "Jane", source: "PHONE", status: "WON" }));
    expect(mocks.createLead).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: "WEBSITE", status: "NEW" }),
    }));
  });

  it("assigns the lead to the source owner", async () => {
    await POST(request({ name: "Jane" }));
    expect(mocks.createLead).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "owner-1" }),
    }));
  });
});
