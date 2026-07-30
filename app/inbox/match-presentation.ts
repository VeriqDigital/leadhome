import type { ConversationMatchKind } from "@prisma/client";
import type { LeadMatchResult } from "@/lib/messaging/matching-service";

export type ConversationMatchPresentation = {
  summary: string;
  badge: "Exact match" | "Possible match" | null;
};

export function conversationMatchPresentation({
  leadId,
  manuallyDetached,
  persistedKind,
  persistedReason,
  evaluatedMatch,
}: {
  leadId: string | null;
  manuallyDetached: boolean;
  persistedKind: ConversationMatchKind | null;
  persistedReason: string | null;
  evaluatedMatch: LeadMatchResult | null;
}): ConversationMatchPresentation {
  if (leadId) {
    return {
      summary: persistedReason ?? "Conversation is attached to a lead.",
      badge: null,
    };
  }
  if (manuallyDetached) {
    return { summary: "Manually detached.", badge: null };
  }

  const kind = evaluatedMatch?.kind ?? persistedKind;
  const summary =
    evaluatedMatch?.reason ??
    persistedReason ??
    (kind === "NO_MATCH"
      ? "No external participant matched."
      : "No match result is available.");

  return {
    summary,
    badge:
      kind === "AMBIGUOUS"
        ? "Possible match"
        : evaluatedMatch?.kind === "MATCHED"
          ? "Exact match"
          : null,
  };
}
