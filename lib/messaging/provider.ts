import type {
  ConversationStatus,
  MessageDirection,
  MessageProvider as ProviderName,
  Prisma,
} from "@prisma/client";

export type ProviderConversation = {
  providerConversationId: string;
  subject: string | null;
  status: ConversationStatus;
};

export type ProviderMessage = {
  providerMessageId: string;
  providerConversationId: string;
  direction: MessageDirection;
  sender: string;
  recipients: string[];
  subject: string | null;
  bodyText: string;
  bodyHtml?: string | null;
  receivedAt: Date;
  metadata?: Prisma.InputJsonValue;
};

export interface MessageProvider {
  readonly provider: ProviderName;
  listRecentConversations(): Promise<ProviderConversation[]>;
  listMessages(providerConversationId: string): Promise<ProviderMessage[]>;
  getConversation(providerConversationId: string): Promise<ProviderConversation | null>;
  getMessage(providerMessageId: string): Promise<ProviderMessage | null>;
}
