import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseConversationAnalysisOutput } from "./schema";

const requestSchema = z
  .object({
    analysisId: z.cuid(),
    itemIndex: z.coerce.number().int().min(0).max(7),
  })
  .strict();

export type ConversationAnalysisTaskPrefill = {
  title: string;
  description: string | null;
  dueAt: Date | null;
  leadId: string | null;
  conversationId: string;
  type: "FOLLOW_UP";
  priority: "NORMAL";
};

/**
 * Resolves AI suggestion text only after an owner-scoped database read. URLs
 * contain the analysis ID and bounded item index, never model-produced text.
 */
export async function getConversationAnalysisTaskPrefill(
  ownerId: string,
  analysisId: string | undefined,
  itemIndex: string | undefined,
): Promise<ConversationAnalysisTaskPrefill | null> {
  const request = requestSchema.safeParse({ analysisId, itemIndex });
  if (!request.success) return null;

  const analysis = await prisma.conversationAnalysis.findFirst({
    where: {
      id: request.data.analysisId,
      ownerId,
    },
    select: {
      structuredData: true,
      conversation: {
        select: {
          id: true,
          leadId: true,
        },
      },
    },
  });
  if (!analysis?.structuredData) return null;

  const structured = (() => {
    try {
      return parseConversationAnalysisOutput(analysis.structuredData);
    } catch {
      return null;
    }
  })();
  const item = structured?.actionItems[request.data.itemIndex];
  if (!item) return null;

  return {
    title: item.title,
    description: item.description,
    dueAt: item.dueDate ? new Date(`${item.dueDate}T12:00:00`) : null,
    leadId: analysis.conversation.leadId,
    conversationId: analysis.conversation.id,
    type: "FOLLOW_UP",
    priority: "NORMAL",
  };
}
