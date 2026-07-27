"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conversationAnalysisConfigurationStatus } from "@/lib/ai/config";
import { setConversationIntelligencePreference } from "@/lib/ai/conversation-analysis/job-service";
import { requireUser } from "@/lib/auth-user";
import { reportOperationalError } from "@/lib/server-errors";

const preferenceSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export type ConversationIntelligencePreferenceState = {
  success: boolean;
  message: string;
  enabled?: boolean;
};

export async function setConversationIntelligencePreferenceAction(
  _state: ConversationIntelligencePreferenceState,
  formData: FormData,
): Promise<ConversationIntelligencePreferenceState> {
  const enabled = preferenceSchema.safeParse(formData.get("enabled"));
  if (!enabled.success) {
    return {
      success: false,
      message: "Choose whether Conversation Intelligence should be enabled.",
    };
  }

  const user = await requireUser();
  if (enabled.data) {
    const configuration = conversationAnalysisConfigurationStatus();
    if (!configuration.available) {
      return {
        success: false,
        enabled: false,
        message: configuration.message,
      };
    }
  }

  try {
    const result = await setConversationIntelligencePreference(
      user.id,
      enabled.data,
    );
    revalidatePath("/settings");
    revalidatePath("/inbox");

    if (result.enabled) {
      return {
        success: true,
        enabled: true,
        message:
          "Conversation Intelligence enabled. Existing conversations were not queued for analysis.",
      };
    }

    return {
      success: true,
      enabled: false,
      message:
        result.cancelled || result.cancellationRequested
          ? "Conversation Intelligence disabled. Queued analyses were cancelled, and any analysis already running was asked to stop."
          : "Conversation Intelligence disabled. New automatic analyses will not be queued.",
    };
  } catch (error) {
    reportOperationalError(
      "update Conversation Intelligence preference failed",
      error,
    );
    return {
      success: false,
      message:
        "Conversation Intelligence could not be updated. Please try again.",
    };
  }
}
