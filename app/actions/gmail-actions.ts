"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { GmailProvider } from "@/lib/messaging/gmail-provider";
import { importProviderAccount } from "@/lib/messaging/import-service";
import { createGmailClient, isRevokedGrant } from "@/lib/gmail/gmail-client";
import { decryptToken } from "@/lib/gmail/token-crypto";

export async function syncGmailAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("accountId") ?? "");
  const account = await prisma.communicationAccount.findFirst({ where: { id, ownerId: user.id, provider: "GMAIL", status: "CONNECTED" } });
  if (!account) return;
  try {
    await importProviderAccount({ ownerId: user.id, provider: new GmailProvider(id, user.id) });
    await prisma.communicationAccount.updateMany({ where: { id, ownerId: user.id }, data: { lastSyncError: null } });
  } catch (error) {
    await prisma.communicationAccount.updateMany({
      where: { id, ownerId: user.id },
      data: { lastSyncError: isRevokedGrant(error) ? "Google access was revoked. Reconnect Gmail." : "Gmail sync failed. Please try again.",
        ...(isRevokedGrant(error) ? { status: "RECONNECT_REQUIRED" as const } : {}) },
    });
  }
  revalidatePath("/settings");
}

export async function disconnectGmailAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("accountId") ?? "");
  const account = await prisma.communicationAccount.findFirst({
    where: { id, ownerId: user.id, provider: "GMAIL" }, include: { gmailCredential: true },
  });
  if (!account) return;
  if (account.gmailCredential) {
    try {
      const { account: owned } = await createGmailClient(id, user.id);
      const token = decryptToken(account.gmailCredential.encryptedRefreshToken);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
      void owned;
    } catch { /* Local disconnection must still succeed if Google is unavailable. */ }
  }
  await prisma.$transaction([
    prisma.gmailCredential.deleteMany({ where: { communicationAccountId: id } }),
    prisma.communicationAccount.updateMany({
      where: { id, ownerId: user.id }, data: { status: "DISCONNECTED", disconnectedAt: new Date(), tokenExpiresAt: null },
    }),
  ]);
  redirect("/settings?gmail=disconnected");
}
