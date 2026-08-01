import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const TTL_MS = 10 * 60 * 1000;
export const OAUTH_INITIATION_DUPLICATE_WINDOW_MS = 15_000;
const hash = (value: string) =>
  createHmac("sha256", process.env.AUTH_SECRET ?? "").update(value).digest("hex");

export type OAuthStateFailureReason =
  | "state_not_found"
  | "state_already_used"
  | "state_owner_mismatch"
  | "state_purpose_mismatch"
  | "state_expired"
  | "state_hash_mismatch";

export type OAuthStateConsumptionResult =
  | { kind: "consumed"; stateExisted: true }
  | {
      kind: "invalid";
      reasonCode: OAuthStateFailureReason;
      stateExisted: boolean;
    };

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

export async function consumeOAuthState(
  value: string,
  userId: string,
  purpose = "gmail-connect",
  now = new Date(),
): Promise<OAuthStateConsumptionResult> {
  const expected = hash(value);
  const state = await prisma.oAuthState.findUnique({ where: { tokenHash: expected } });
  if (!state) {
    return {
      kind: "invalid",
      reasonCode: "state_not_found",
      stateExisted: false,
    };
  }
  if (state.usedAt) {
    return {
      kind: "invalid",
      reasonCode: "state_already_used",
      stateExisted: true,
    };
  }
  if (state.userId !== userId) {
    return {
      kind: "invalid",
      reasonCode: "state_owner_mismatch",
      stateExisted: true,
    };
  }
  if (state.purpose !== purpose) {
    return {
      kind: "invalid",
      reasonCode: "state_purpose_mismatch",
      stateExisted: true,
    };
  }
  if (state.expiresAt <= now) {
    return {
      kind: "invalid",
      reasonCode: "state_expired",
      stateExisted: true,
    };
  }
  if (!timingSafeEqual(Buffer.from(state.tokenHash), Buffer.from(expected))) {
    return {
      kind: "invalid",
      reasonCode: "state_hash_mismatch",
      stateExisted: true,
    };
  }
  const consumed = await prisma.oAuthState.updateMany({
    where: { id: state.id, usedAt: null },
    data: { usedAt: now },
  });
  if (consumed.count !== 1) {
    return {
      kind: "invalid",
      reasonCode: "state_already_used",
      stateExisted: true,
    };
  }
  return { kind: "consumed", stateExisted: true };
}
