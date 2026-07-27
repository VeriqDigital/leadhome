import "server-only";

import type { ConversationAnalysisStatus } from "@prisma/client";
import { conversationAnalysisConfigurationStatus } from "@/lib/ai/config";
import {
  conversationAnalysisOutputSchema,
  type ConversationAnalysisOutput,
} from "./schema";
import { getConversationAnalysisJob } from "@/lib/jobs/service";
import type { ConversationAnalysisJobView } from "@/lib/jobs/types";
import { prisma } from "@/lib/prisma";

export type ConversationIntelligenceAnalysisView = {
  id: string;
  status: ConversationAnalysisStatus;
  output: ConversationAnalysisOutput | null;
  outputInvalid: boolean;
  inputTruncated: boolean;
  completedAt: string | null;
  updatedAt: string;
};

export type ConversationIntelligenceView = {
  enabled: boolean;
  configuration: {
    available: boolean;
    message: string;
  };
  analysis: ConversationIntelligenceAnalysisView | null;
  job: ConversationAnalysisJobView | null;
};

export async function getConversationIntelligenceView(
  ownerId: string,
  conversationId: string,
): Promise<ConversationIntelligenceView | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, ownerId },
    select: {
      owner: {
        select: { conversationIntelligenceEnabled: true },
      },
      analysis: {
        select: {
          id: true,
          latestJobId: true,
          status: true,
          structuredData: true,
          inputTruncated: true,
          completedAt: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!conversation) return null;

  const parsedOutput = conversation.analysis?.structuredData
    ? conversationAnalysisOutputSchema.safeParse(
        conversation.analysis.structuredData,
      )
    : null;
  const job = conversation.analysis?.latestJobId
    ? await getConversationAnalysisJob(
        ownerId,
        conversation.analysis.latestJobId,
      )
    : null;

  return {
    enabled: conversation.owner.conversationIntelligenceEnabled,
    configuration: conversationAnalysisConfigurationStatus(),
    analysis: conversation.analysis
      ? {
          id: conversation.analysis.id,
          status: conversation.analysis.status,
          output: parsedOutput?.success ? parsedOutput.data : null,
          outputInvalid: Boolean(parsedOutput && !parsedOutput.success),
          inputTruncated: conversation.analysis.inputTruncated,
          completedAt:
            conversation.analysis.completedAt?.toISOString() ?? null,
          updatedAt: conversation.analysis.updatedAt.toISOString(),
        }
      : null,
    job,
  };
}
