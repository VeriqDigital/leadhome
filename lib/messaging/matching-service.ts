import "server-only";

import type { Conversation, Lead, Message } from "@prisma/client";

export async function findLeadForConversation(
  conversation: Conversation,
): Promise<Lead | null> {
  void conversation;
  return null;
}

export async function findLeadForMessage(
  message: Message,
): Promise<Lead | null> {
  void message;
  return null;
}
