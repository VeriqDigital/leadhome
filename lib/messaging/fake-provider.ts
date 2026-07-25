import type { MessageProvider, ProviderConversation, ProviderMessage } from "./provider";

const fixtureKinds = [
  ["website-inquiry", "Website inquiry", "Could you tell me whether you serve North Austin?"],
  ["roof-quote", "Roof replacement quote", "We need a quote for replacing our roof this fall."],
  ["appointment", "Appointment request", "Is Tuesday afternoon available for an inspection?"],
  ["returning-customer", "Returning customer", "You helped us last year and we have another project."],
  ["newsletter", "July contractor newsletter", "This month: material pricing and industry news."],
  ["spam", "You have won a business award", "Pay a small processing fee to claim your award."],
  ["internal", "Friday crew schedule", "The updated crew assignments are attached."],
] as const;

export const fakeConversations: ProviderConversation[] = fixtureKinds.map(
  ([id, subject]) => ({
    providerConversationId: `fake-conversation-${id}`,
    subject,
    status: id === "spam" ? "SPAM" : id === "newsletter" ? "ARCHIVED" : "OPEN",
  }),
);

export const fakeMessages: ProviderMessage[] = fixtureKinds.map(
  ([id, subject, body], index) => ({
    providerMessageId: `fake-message-${id}-1`,
    providerConversationId: `fake-conversation-${id}`,
    direction: id === "internal" ? "OUTBOUND" : "INBOUND",
    sender: id === "internal" ? "ops@leadhome.test" : `${id}@example.test`,
    recipients: id === "internal" ? ["crew@leadhome.test"] : ["inbox@leadhome.test"],
    subject,
    bodyText: body,
    receivedAt: new Date(`2026-07-${String(10 + index).padStart(2, "0")}T14:00:00.000Z`),
    metadata: { fixture: true, category: id },
  }),
);

export class FakeProvider implements MessageProvider {
  readonly provider = "FAKE" as const;

  async listRecentConversations() {
    return fakeConversations;
  }

  async listMessages(providerConversationId: string) {
    return fakeMessages.filter(
      (message) => message.providerConversationId === providerConversationId,
    );
  }

  async getConversation(providerConversationId: string) {
    return fakeConversations.find(
      (conversation) =>
        conversation.providerConversationId === providerConversationId,
    ) ?? null;
  }

  async getMessage(providerMessageId: string) {
    return fakeMessages.find(
      (message) => message.providerMessageId === providerMessageId,
    ) ?? null;
  }
}
