import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { consumeOAuthState } from "@/lib/gmail/oauth-state";
import { googleOAuthClient } from "@/lib/gmail/google-oauth";
import { encryptToken } from "@/lib/gmail/token-crypto";

const settings = (request: Request, result: string) =>
  NextResponse.redirect(new URL(`/settings?gmail=${result}`, request.url));

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return settings(request, "session");
  const params = new URL(request.url).searchParams;
  if (params.get("error")) return settings(request, "denied");
  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code) return settings(request, "invalid");
  try {
    await consumeOAuthState(state, session.user.id);
    const oauth = googleOAuthClient();
    const { tokens } = await oauth.getToken(code);
    oauth.setCredentials(tokens);
    const oauth2 = (await import("googleapis")).google.oauth2({ version: "v2", auth: oauth });
    const identity = (await oauth2.userinfo.get()).data;
    if (!identity.id || !identity.email) return settings(request, "profile");
    const existing = await prisma.communicationAccount.findUnique({
      where: { provider_providerAccountId: { provider: "GMAIL", providerAccountId: identity.id } },
      include: { gmailCredential: true },
    });
    if (existing && existing.ownerId !== session.user.id) return settings(request, "conflict");
    const refreshToken = tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : existing?.gmailCredential?.encryptedRefreshToken;
    if (!refreshToken) return settings(request, "refresh");
    const account = await prisma.communicationAccount.upsert({
      where: { ownerId_provider_providerAccountId: { ownerId: session.user.id, provider: "GMAIL", providerAccountId: identity.id } },
      create: { ownerId: session.user.id, provider: "GMAIL", providerAccountId: identity.id, displayName: identity.name ?? identity.email, address: identity.email,
        grantedScopes: tokens.scope, tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null },
      update: { displayName: identity.name ?? identity.email, address: identity.email, grantedScopes: tokens.scope,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null, status: "CONNECTED", disconnectedAt: null, lastSyncError: null },
    });
    await prisma.gmailCredential.upsert({
      where: { communicationAccountId: account.id },
      create: { communicationAccountId: account.id, encryptedRefreshToken: refreshToken,
        encryptedAccessToken: tokens.access_token ? encryptToken(tokens.access_token) : null },
      update: { encryptedRefreshToken: refreshToken,
        ...(tokens.access_token ? { encryptedAccessToken: encryptToken(tokens.access_token) } : {}) },
    });
    return settings(request, "connected");
  } catch {
    return settings(request, "error");
  }
}
