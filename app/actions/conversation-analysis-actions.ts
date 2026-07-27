"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-user";
import { conversationAnalysisConfigurationStatus } from "@/lib/ai/config";
import { enqueueConversationAnalysisJob } from "@/lib/ai/conversation-analysis/job-service";
import type { ConversationAnalysisJobView } from "@/lib/jobs/types";
import { prisma } from "@/lib/prisma";
import { reportOperationalError } from "@/lib/server-errors";

const conversationIdSchema = z.string().cuid();

export type ConversationAnalysisActionState = {
  success: boolean;
  message: string;
  job?: ConversationAnalysisJobView;
};

export async function analyzeConversationAction(
  _state: ConversationAnalysisActionState,
  formData: FormData,
): Promise<ConversationAnalysisActionState> {
  const user = await requireUser();
  const parsed = conversationIdSchema.safeParse(
    formData.get("conversationId"),
  );
  if (!parsed.success) {
    return {
      success: false,
      message: "Choose a valid conversation to analyze.",
    };
  }

  const [preference, conversation] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { conversationIntelligenceEnabled: true },
    }),
    prisma.conversation.findFirst({
      where: { id: parsed.data, ownerId: user.id },
      select: { id: true },
    }),
  ]);
  if (!conversation) {
    return {
      success: false,
      message: "This conversation is unavailable.",
    };
  }
  if (!preference?.conversationIntelligenceEnabled) {
    return {
      success: false,
      message: "Enable Conversation Intelligence in Settings first.",
    };
  }
  if (!conversationAnalysisConfigurationStatus().available) {
    return {
      success: false,
      message:
        "Conversation analysis is unavailable until the server configuration is completed.",
    };
  }

  try {
    const result = await enqueueConversationAnalysisJob({
      ownerId: user.id,
      conversationId: conversation.id,
      trigger: "MANUAL_REANALYSIS",
      force: true,
    });
    switch (result.kind) {
      case "queued":
        revalidatePath("/inbox");
        return {
          success: true,
          message: "Analysis queued.",
          job: result.job,
        };
      case "existing":
        return {
          success: true,
          message: "This analysis is already in progress.",
          job: result.job,
        };
      case "no-content":
        revalidatePath("/inbox");
        return {
          success: true,
          message: "This conversation does not contain enough message text to analyze.",
        };
      case "disabled":
        return {
          success: false,
          message: "Enable Conversation Intelligence in Settings first.",
        };
      case "not-found":
        return {
          success: false,
          message: "This conversation is unavailable.",
        };
      case "unchanged":
        revalidatePath("/inbox");
        return {
          success: true,
          message: "The current conversation content is already analyzed.",
        };
      case "unlinked":
        return {
          success: false,
          message: "This conversation could not be queued for analysis.",
        };
    }
  } catch (error) {
    reportOperationalError("queue conversation analysis failed", error);
    return {
      success: false,
      message: "Conversation analysis could not be queued. Please try again.",
    };
  }
}
