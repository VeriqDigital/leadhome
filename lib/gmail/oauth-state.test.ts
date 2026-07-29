import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import {
  OAUTH_INITIATION_DUPLICATE_WINDOW_MS,
  beginOAuthState,
} from "./oauth-state";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-auth-secret");
  mocks.executeRaw.mockResolvedValue(1);
  mocks.findFirst.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: "state-a" });
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      $executeRaw: mocks.executeRaw,
      oAuthState: {
        findFirst: mocks.findFirst,
        create: mocks.create,
      },
    }),
  );
});

describe("Gmail OAuth initiation state", () => {
  it("serializes initiation and creates one opaque state", async () => {
    const now = new Date("2026-07-29T18:00:00.000Z");
    const result = await beginOAuthState("owner-a", "gmail-connect", now);

    expect(result).toEqual({
      kind: "accepted",
      state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    const sql = (
      mocks.executeRaw.mock.calls[0][0] as { strings?: readonly string[] }
    ).strings?.join("");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "owner-a",
        purpose: "gmail-connect",
        usedAt: null,
        expiresAt: { gt: now },
        createdAt: {
          gte: new Date(
            now.getTime() - OAUTH_INITIATION_DUPLICATE_WINDOW_MS,
          ),
        },
      },
      select: { id: true },
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        userId: "owner-a",
        purpose: "gmail-connect",
        expiresAt: new Date("2026-07-29T18:10:00.000Z"),
      },
    });
  });

  it("rejects a recent duplicate without replacing its state", async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: "existing-state" });

    await expect(beginOAuthState("owner-a")).resolves.toEqual({
      kind: "duplicate",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
