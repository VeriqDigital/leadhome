import "server-only";

import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { reportOperationalError } from "@/lib/server-errors";
import { decryptToken, encryptToken } from "./token-crypto";
import { googleOAuthClient } from "./google-oauth";

export async function createGmailClient(accountId: string, ownerId: string) {
  const account = await prisma.communicationAccount.findFirst({
    where: {
      id: accountId,
      ownerId,
      provider: "GMAIL",
      status: "CONNECTED",
    },
    include: { gmailCredential: true },
  });
  if (!account?.gmailCredential) throw new Error("Gmail is not connected.");
  const oauth = googleOAuthClient();
  oauth.setCredentials({
    refresh_token: decryptToken(account.gmailCredential.encryptedRefreshToken),
    access_token: account.gmailCredential.encryptedAccessToken
      ? decryptToken(account.gmailCredential.encryptedAccessToken)
      : undefined,
    expiry_date: account.tokenExpiresAt?.getTime(),
  });
  oauth.on("tokens", (tokens) => {
    void (async () => {
      const connected = await prisma.communicationAccount.updateMany({
        where: {
          id: account.id,
          ownerId,
          status: "CONNECTED",
        },
        data: { tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined },
      });
      if (connected.count && tokens.access_token) {
        await prisma.gmailCredential.updateMany({
          where: { communicationAccountId: account.id },
          data: { encryptedAccessToken: encryptToken(tokens.access_token) },
        });
      }
    })().catch((error) => {
      reportOperationalError("persist Gmail token refresh failed", error);
    });
  });
  return { gmail: google.gmail({ version: "v1", auth: oauth }), account };
}

export function isRevokedGrant(error: unknown) {
  const candidate = error as { response?: { data?: { error?: string } }; message?: string };
  return candidate.response?.data?.error === "invalid_grant" || candidate.message?.includes("invalid_grant");
}
