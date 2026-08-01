import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GmailReplyLink, gmailThreadUrl } from "./gmail-reply-link";

describe("Gmail reply link", () => {
  it("opens the exact Gmail thread for the connected mailbox", () => {
    expect(gmailThreadUrl({
      accountAddress: "hello@example.com",
      providerConversationId: "18f0abc123def456",
    })).toBe(
      "https://mail.google.com/mail/u/?authuser=hello%40example.com#all/18f0abc123def456",
    );

    const markup = renderToStaticMarkup(
      <GmailReplyLink
        provider="GMAIL"
        providerConversationId="18f0abc123def456"
        accountAddress="hello@example.com"
      />,
    );

    expect(markup).toContain("Reply in Gmail");
    expect(markup).toContain("action-primary");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("authuser=hello%40example.com");
    expect(markup).toContain("#all/18f0abc123def456");
    expect(markup).toContain("opens in a new tab");
  });

  it("does not render for other providers or malformed thread IDs", () => {
    expect(renderToStaticMarkup(
      <GmailReplyLink
        provider="FAKE"
        providerConversationId="fake-thread"
        accountAddress="hello@example.com"
      />,
    )).toBe("");
    expect(renderToStaticMarkup(
      <GmailReplyLink
        provider="GMAIL"
        providerConversationId="not/a/gmail/thread"
        accountAddress="hello@example.com"
      />,
    )).toBe("");
    expect(gmailThreadUrl({
      accountAddress: null,
      providerConversationId: "18f0abc123def456",
    })).toBeNull();
  });
});
