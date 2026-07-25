import "server-only";

import { prisma } from "@/lib/prisma";
import { findLeadForConversation, findLeadForMessage } from "./matching-service";
import type { MessageProvider } from "./provider";

export async function importRecentMessages({
  ownerId,
  provider,
  displayName,
  address,
  providerAccountId,
}: {
  ownerId: string;
  provider: MessageProvider;
  displayName: string;
  address?: string;
  providerAccountId: string;
}) {
  const account = await prisma.communicationAccount.upsert({
    where: {
      ownerId_provider_providerAccountId: {
        ownerId,
        provider: provider.provider,
        providerAccountId,
      },
    },
    create: {
      ownerId,
      provider: provider.provider,
      displayName,
      address,
      providerAccountId,
    },
    update: { displayName, address },
  });

  let conversationsImported = 0;
  let messagesImported = 0;
  for (const externalConversation of await provider.listRecentConversations()) {
    const conversation = await prisma.conversation.upsert({
      where: {
        accountId_providerConversationId: {
          accountId: account.id,
          providerConversationId: externalConversation.providerConversationId,
        },
      },
      create: {
        accountId: account.id,
        ownerId,
        provider: provider.provider,
        ...externalConversation,
      },
      update: {
        subject: externalConversation.subject,
        status: externalConversation.status,
      },
    });
    conversationsImported += 1;
    await findLeadForConversation(conversation);

    for (const externalMessage of await provider.listMessages(
      externalConversation.providerConversationId,
    )) {
      const message = await prisma.message.upsert({
        where: {
          accountId_providerMessageId: {
            accountId: account.id,
            providerMessageId: externalMessage.providerMessageId,
          },
        },
        create: {
          conversationId: conversation.id,
          accountId: account.id,
          ownerId,
          providerMessageId: externalMessage.providerMessageId,
          direction: externalMessage.direction,
          sender: externalMessage.sender,
          recipients: externalMessage.recipients,
          subject: externalMessage.subject,
          bodyText: externalMessage.bodyText,
          bodyHtml: externalMessage.bodyHtml,
          receivedAt: externalMessage.receivedAt,
          metadata: externalMessage.metadata,
        },
        update: {},
      });
      messagesImported += 1;
      await findLeadForMessage(message);
    }
  }

  return { accountId: account.id, conversationsImported, messagesImported };
}
