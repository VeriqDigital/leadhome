import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const TTL_MS = 10 * 60 * 1000;
export const OAUTH_INITIATION_DUPLICATE_WINDOW_MS = 15_000;
const hash = (value: string) =>
  createHmac("sha256", process.env.AUTH_SECRET ?? "").update(value).digest("hex");

export async function beginOAuthState(
  userId: string,
  purpose = "gmail-connect",
  now = new Date(),
): Promise<
  | { kind: "accepted"; state: string }
  | { kind: "duplicate" }
> {
  return prisma.$transaction(async (tx) => {
    const mutexKey = `oauth-initiation:${userId}:${purpose}`;
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${mutexKey}, 0::bigint)
      )
    `);

    const duplicate = await tx.oAuthState.findFirst({
      where: {
        userId,
        purpose,
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
    if (duplicate) return { kind: "duplicate" };

    const state = randomBytes(32).toString("base64url");
    await tx.oAuthState.create({
      data: {
        tokenHash: hash(state),
        userId,
        purpose,
        expiresAt: new Date(now.getTime() + TTL_MS),
      },
    });
    return { kind: "accepted", state };
  });
}

export async function consumeOAuthState(value: string, userId: string, purpose = "gmail-connect") {
  const expected = hash(value);
  const state = await prisma.oAuthState.findUnique({ where: { tokenHash: expected } });
  if (!state || state.usedAt || state.userId !== userId || state.purpose !== purpose || state.expiresAt <= new Date()) {
    throw new Error("This authorization request is invalid, expired, or already used.");
  }
  if (!timingSafeEqual(Buffer.from(state.tokenHash), Buffer.from(expected))) throw new Error("Invalid OAuth state.");
  const consumed = await prisma.oAuthState.updateMany({
    where: { id: state.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) throw new Error("This authorization request was already used.");
}
