import type {
  MessageProvider,
  NormalizedConversation,
  NormalizedMessage,
  NormalizedProviderAccount,
} from "./provider";

type Fixture = NormalizedConversation & { messages: NormalizedMessage[] };

const at = (day: number, hour = 14) =>
  new Date(`2026-07-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`);

const inbound = (
  id: string,
  sender: string,
  subject: string | null,
  bodyText: string | null,
  day: number,
  extra: Partial<NormalizedMessage> = {},
): NormalizedMessage => ({
  providerMessageId: `fake-message-${id}`,
  direction: "INBOUND",
  sender,
  recipients: ["inbox@leadhome.test"],
  subject,
  bodyText,
  occurredAt: at(day),
  internetMessageId: `<${id}@fake.leadhome.test>`,
  metadata: { fixture: true },
  ...extra,
});

export const fakeProviderAccount: NormalizedProviderAccount = {
  provider: "FAKE",
  providerAccountId: "lead-home-development-fixtures",
  displayName: "Development inbox",
  address: "inbox@leadhome.test",
};

export const fakeFixtures: Fixture[] = [
  {
    providerConversationId: "fake-conversation-exact-match",
    subject: "Exact lead email match",
    suggestedClassification: "LEAD",
    messages: [
      inbound("exact-match", "jane@example.com", "Exact lead email match", "Can we discuss the estimate?", 24),
    ],
  },
  {
    providerConversationId: "fake-conversation-unmatched",
    subject: "Unmatched sales inquiry",
    suggestedClassification: "LEAD",
    messages: [
      inbound("unmatched", "new-prospect@example.test", "Unmatched sales inquiry", "I would like a quote.", 23),
    ],
  },
  {
    providerConversationId: "fake-conversation-ambiguous",
    subject: "Shared contact address",
    suggestedClassification: "UNKNOWN",
    messages: [
      inbound("ambiguous", "shared@example.com", "Shared contact address", "Following up.", 22),
    ],
  },
  {
    providerConversationId: "fake-conversation-newsletter",
    subject: "July contractor newsletter",
    state: "ARCHIVED",
    suggestedClassification: "NEWSLETTER",
    suggestedReviewState: "IGNORED",
    messages: [
      inbound("newsletter", "newsletter@example.test", "July contractor newsletter", "Material pricing and industry news.", 21),
    ],
  },
  {
    providerConversationId: "fake-conversation-spam",
    subject: "You have won a business award",
    suggestedClassification: "SPAM",
    suggestedReviewState: "IGNORED",
    messages: [
      inbound("spam", "spam@example.test", "You have won a business award", "Pay a processing fee.", 20),
    ],
  },
  {
    providerConversationId: "fake-conversation-internal",
    subject: "Friday crew schedule",
    suggestedClassification: "INTERNAL",
    suggestedReviewState: "IGNORED",
    messages: [
      inbound("internal", "ops@leadhome.test", "Friday crew schedule", "Updated crew assignments.", 19),
    ],
  },
  {
    providerConversationId: "fake-conversation-outbound",
    subject: "Outbound estimate",
    suggestedClassification: "CUSTOMER",
    messages: [{
      providerMessageId: "fake-message-outbound",
      direction: "OUTBOUND",
      sender: "inbox@leadhome.test",
      recipients: ["customer@example.test"],
      subject: "Outbound estimate",
      bodyText: "Here is the estimate.",
      occurredAt: at(18),
    }],
  },
  {
    providerConversationId: "fake-conversation-returning",
    subject: "Returning customer",
    suggestedClassification: "CUSTOMER",
    messages: [
      inbound("returning-1", "returning-customer@example.test", "Returning customer", "You helped last year.", 16),
      inbound("returning-2", "returning-customer@example.test", "Re: Returning customer", "Here is a new reply.", 17),
    ],
  },
  {
    providerConversationId: "fake-conversation-website-notification",
    subject: "Website form notification",
    suggestedClassification: "LEAD",
    messages: [
      inbound("website", "forms@website.test", "Website form notification", "A form was submitted.", 15, {
        externalSubmissionId: "contact-12345",
        sourceSystem: "leadhome-website-form",
      }),
    ],
  },
  {
    providerConversationId: "fake-conversation-no-subject",
    subject: null,
    messages: [inbound("no-subject", "anonymous@example.test", null, "No subject here.", 14)],
  },
  {
    providerConversationId: "fake-conversation-html-only",
    subject: "HTML-only message",
    messages: [inbound("html-only", "html@example.test", "HTML-only message", null, 13, {
      bodyHtml: "<p>This fixture has no text body.</p>",
    })],
  },
  {
    providerConversationId: "fake-conversation-out-of-order",
    subject: "Messages returned out of order",
    messages: [
      inbound("order-new", "order@example.test", "Re: Ordering", "Newer reply.", 12, { occurredAt: at(12, 16) }),
      inbound("order-old", "order@example.test", "Ordering", "Older message.", 12, { occurredAt: at(12, 9) }),
    ],
  },
];

export class FakeProvider implements MessageProvider {
  readonly provider = "FAKE" as const;

  constructor(private readonly fixtures: Fixture[] = fakeFixtures) {}

  async getAccount() {
    return fakeProviderAccount;
  }

  async listRecentConversations() {
    return this.fixtures.map((fixture) => ({
      providerConversationId: fixture.providerConversationId,
      subject: fixture.subject,
      state: fixture.state,
      suggestedClassification: fixture.suggestedClassification,
      suggestedReviewState: fixture.suggestedReviewState,
      metadata: fixture.metadata,
    }));
  }

  async listMessages(providerConversationId: string) {
    const messages =
      this.fixtures.find(
        (fixture) => fixture.providerConversationId === providerConversationId,
      )?.messages ?? [];
    // A provider may return duplicates; the importer must remain idempotent.
    return providerConversationId === "fake-conversation-out-of-order"
      ? [...messages, messages[0]]
      : messages;
  }

  async getConversation(providerConversationId: string) {
    const fixture = this.fixtures.find(
      (item) => item.providerConversationId === providerConversationId,
    );
    if (!fixture) return null;
    return {
      providerConversationId: fixture.providerConversationId,
      subject: fixture.subject,
      state: fixture.state,
      suggestedClassification: fixture.suggestedClassification,
      suggestedReviewState: fixture.suggestedReviewState,
      metadata: fixture.metadata,
    };
  }
}
