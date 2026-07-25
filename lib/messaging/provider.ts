import type {
  ConversationClassification,
  ConversationReviewState,
  ConversationStatus,
  MessageDirection,
  MessageProvider as ProviderName,
  Prisma,
} from "@prisma/client";

export type NormalizedProviderAccount = {
  provider: ProviderName;
  providerAccountId: string;
  displayName: string;
  address?: string | null;
};

export type NormalizedMessage = {
  providerMessageId: string;
  direction: MessageDirection;
  sender: string;
  recipients: string[];
  replyTo?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  occurredAt: Date;
  internetMessageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  externalSubmissionId?: string | null;
  sourceSystem?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export type NormalizedConversation = {
  providerConversationId: string;
  subject?: string | null;
  state?: ConversationStatus;
  suggestedClassification?: ConversationClassification;
  suggestedReviewState?: ConversationReviewState;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Provider adapters own normalization. The import pipeline never consumes raw
 * Gmail, Outlook, or fixture payloads and never branches on a provider name.
 */
export interface MessageProvider {
  readonly provider: ProviderName;
  getAccount(): Promise<NormalizedProviderAccount>;
  listRecentConversations(): Promise<NormalizedConversation[]>;
  getConversation(
    providerConversationId: string,
  ): Promise<NormalizedConversation | null>;
  listMessages(providerConversationId: string): Promise<NormalizedMessage[]>;
}
