"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth-user";
import { decryptToken } from "@/lib/gmail/token-crypto";
import {
  disconnectGmailAccount,
  enqueueGmailSyncJob,
} from "@/lib/jobs/service";
import type { GmailSyncJobView } from "@/lib/jobs/types";
import { reportOperationalError } from "@/lib/server-errors";

const accountIdSchema = z.string().cuid();

export type GmailSyncActionState = {
  success: boolean;
  message: string;
  job?: GmailSyncJobView;
};

export async function syncGmailAction(
  _state: GmailSyncActionState,
  formData: FormData,
): Promise<GmailSyncActionState> {
  const user = await requireUser();
  const parsed = accountIdSchema.safeParse(formData.get("accountId"));
  if (!parsed.success) {
    return {
      success: false,
      message: "Choose a valid Gmail connection.",
    };
  }
  try {
    const result = await enqueueGmailSyncJob(user.id, parsed.data);
    if (result.kind === "not-found") {
      return {
        success: false,
        message: "This Gmail connection is unavailable or needs reconnecting.",
      };
    }
    revalidatePath("/settings");
    revalidatePath("/inbox");
    return {
      success: true,
      message:
        result.kind === "queued"
          ? "Gmail sync queued."
          : "The existing Gmail sync job is still active.",
      job: result.job,
    };
  } catch (error) {
    reportOperationalError("queue Gmail sync failed", error);
    return {
      success: false,
      message: "Gmail sync could not be queued. Please try again.",
    };
  }
}

export async function disconnectGmailAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("accountId") ?? "");
  const result = await disconnectGmailAccount(user.id, id);
  if (result.kind === "not-found") return;
  if (result.encryptedRefreshToken) {
    try {
      const token = decryptToken(result.encryptedRefreshToken);
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
        { method: "POST" },
      );
    } catch { /* Local disconnection must still succeed if Google is unavailable. */ }
  }
  redirect("/settings?gmail=disconnected");
}
