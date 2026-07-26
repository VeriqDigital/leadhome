import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

const TTL_MS = 10 * 60 * 1000;
const hash = (value: string) =>
  createHmac("sha256", process.env.AUTH_SECRET ?? "").update(value).digest("hex");

export async function createOAuthState(userId: string, purpose = "gmail-connect") {
  const value = randomBytes(32).toString("base64url");
  await prisma.oAuthState.create({
    data: { tokenHash: hash(value), userId, purpose, expiresAt: new Date(Date.now() + TTL_MS) },
  });
  return value;
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
