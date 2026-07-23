import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: { inboundSource: { updateMany } },
}));

import { setInboundSourceActive } from "@/lib/inbound-sources";

describe("inbound source ownership", () => {
  beforeEach(() => {
    updateMany.mockImplementation(({ where, data }) => {
      const owned = where.id === "source-a" && where.userId === "user-a";
      return Promise.resolve({ count: owned ? 1 : 0, data });
    });
  });

  it("does not let one account manage another account's source", async () => {
    const result = await setInboundSourceActive("user-b", "source-a", false);
    expect(result.count).toBe(0);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "source-a", userId: "user-b" },
      data: { isActive: false },
    });
  });
});
