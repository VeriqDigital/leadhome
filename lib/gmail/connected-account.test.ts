import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  communicationAccount: { findFirst: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: database }));

import { getConnectedGmailAddress } from "./connected-account";

describe("connected Gmail address", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the newest connected owner-scoped Gmail address", async () => {
    database.communicationAccount.findFirst.mockResolvedValue({
      address: " owner@example.com ",
    });

    await expect(getConnectedGmailAddress("owner-a")).resolves.toBe(
      "owner@example.com",
    );
    expect(database.communicationAccount.findFirst).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-a",
        provider: "GMAIL",
        status: "CONNECTED",
        address: { not: null },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { address: true },
    });
  });

  it("returns null when no connected mailbox is available", async () => {
    database.communicationAccount.findFirst.mockResolvedValue(null);
    await expect(getConnectedGmailAddress("owner-b")).resolves.toBeNull();
  });
});
