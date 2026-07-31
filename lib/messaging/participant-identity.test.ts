import { describe, expect, it } from "vitest";

import {
  externalInboundParticipantIdentity,
  MAX_EXTERNAL_IDENTITY_MESSAGES,
  normalizeEmailAddresses,
  normalizeParticipantName,
} from "./participant-identity";

type IdentityMessage = Parameters<
  typeof externalInboundParticipantIdentity
>[0][number];

function inbound(
  sender: string,
  {
    replyTo = null,
    recipients = [],
  }: {
    replyTo?: string | null;
    recipients?: string[];
  } = {},
): IdentityMessage {
  return {
    direction: "INBOUND",
    sender,
    replyTo,
    recipients,
  };
}

describe("participant identity", () => {
  it("preserves the matching normalizers after extraction", () => {
    expect(normalizeEmailAddresses([
      '"Jane Doe" <JANE@Example.com>',
      "jane@example.com, team@example.com",
    ])).toEqual(["jane@example.com", "team@example.com"]);
    expect(normalizeParticipantName(' "Jane   Doe" <jane@example.com> '))
      .toBe("jane doe");
    expect(normalizeParticipantName("jane@example.com")).toBeNull();
  });

  it("uses inbound senders and reply-to identities but never recipients", () => {
    const identity = externalInboundParticipantIdentity([
      inbound("Sales <sales@northstarroofing.com>", {
        replyTo: "Alex <alex@northstarroofing.com>",
        recipients: ["unrelated@copied-company.com"],
      }),
      {
        direction: "OUTBOUND",
        sender: "Owner <owner@leadhome.test>",
        replyTo: "prospect@outbound-only.com",
        recipients: ["prospect@outbound-only.com"],
      },
    ], []);

    expect(identity).toEqual({
      senderEmails: ["sales@northstarroofing.com"],
      replyToEmails: ["alex@northstarroofing.com"],
      displayNames: ["alex", "sales"],
    });
  });

  it("ignores the connected mailbox and all supplied owner addresses", () => {
    const identity = externalInboundParticipantIdentity([
      inbound("Connected Inbox <inbox@leadhome.test>", {
        replyTo: "Owner Alias <owner@example.com>",
      }),
      inbound("Alex <alex@northstarroofing.com>"),
    ], ["inbox@leadhome.test", "Owner <OWNER@example.com>"]);

    expect(identity).toEqual({
      senderEmails: ["alex@northstarroofing.com"],
      replyToEmails: [],
      displayNames: ["alex"],
    });
  });

  it("ignores malformed address-like values and system-only local parts", () => {
    const identity = externalInboundParticipantIdentity([
      inbound("Fake Person <fake@-invalid.example>"),
      inbound("Another Fake <missing-at.example>"),
      inbound("Delivery Agent <mailer-daemon@northstarroofing.com>"),
      inbound("No Reply <no-reply@northstarroofing.com>"),
      inbound("Tagged No Reply <noreply+campaign@northstarroofing.com>"),
      inbound("Do Not Reply <donotreply@northstarroofing.com>"),
      inbound("Postmaster <postmaster@northstarroofing.com>"),
      inbound("Reserved <person@host.invalid>"),
      inbound("Documentation <person@example.test>"),
      inbound("Numeric host <person@127.0.0.1>"),
      inbound("Credible Person"),
    ], []);

    expect(identity).toEqual({
      senderEmails: [],
      replyToEmails: [],
      displayNames: ["credible person"],
    });
  });

  it("bounds evaluation to the most recent messages", () => {
    const messages = [
      inbound("old@old-company.com"),
      ...Array.from(
        { length: MAX_EXTERNAL_IDENTITY_MESSAGES },
        (_, index) => inbound(`person${index}@current-company.com`),
      ),
    ];

    const identity = externalInboundParticipantIdentity(messages, []);

    expect(identity.senderEmails).toHaveLength(MAX_EXTERNAL_IDENTITY_MESSAGES);
    expect(identity.senderEmails).not.toContain("old@old-company.com");
  });
});
