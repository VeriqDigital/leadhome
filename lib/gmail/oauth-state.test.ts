import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    oAuthState: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  OAUTH_INITIATION_DUPLICATE_WINDOW_MS,
  beginOAuthState,
  consumeOAuthState,
} from "./oauth-state";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-auth-secret");
  mocks.executeRaw.mockResolvedValue(1);
  mocks.findFirst.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: "state-a" });
  mocks.findUnique.mockResolvedValue(null);
  mocks.updateMany.mockResolvedValue({ count: 1 });
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

describe("Gmail OAuth callback state consumption", () => {
  it("returns a stable missing-state result without attempting consumption", async () => {
    await expect(
      consumeOAuthState(
        "missing-state",
        "owner-a",
        "gmail-connect",
        new Date("2026-07-29T18:05:00.000Z"),
      ),
    ).resolves.toEqual({
      kind: "invalid",
      reasonCode: "state_not_found",
      stateExisted: false,
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns a stable expired-state result without consuming it", async () => {
    const now = new Date("2026-07-29T18:11:00.000Z");
    mocks.findUnique.mockResolvedValueOnce({
      id: "state-a",
      tokenHash: expect.any(String),
      userId: "owner-a",
      purpose: "gmail-connect",
      expiresAt: new Date("2026-07-29T18:10:00.000Z"),
      usedAt: null,
    });

    const result = await consumeOAuthState(
      "expired-state",
      "owner-a",
      "gmail-connect",
      now,
    );

    expect(result).toEqual({
      kind: "invalid",
      reasonCode: "state_expired",
      stateExisted: true,
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
