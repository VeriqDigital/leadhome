import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GmailComposeLink, gmailComposeUrl } from "./gmail-compose-link";

describe("lead Gmail compose link", () => {
  it("opens a compose window addressed to the lead from the connected mailbox", () => {
    expect(gmailComposeUrl({
      recipient: "Lead@Example.com",
      accountAddress: "Owner@Example.com",
    })).toBe(
      "https://mail.google.com/mail/u/?authuser=owner%40example.com&view=cm&fs=1&to=lead%40example.com",
    );

    const markup = renderToStaticMarkup(
      <GmailComposeLink
        recipient="lead@example.com"
        leadName="Example Lead"
        accountAddress="owner@example.com"
      />,
    );
    expect(markup).toContain("Email in Gmail");
    expect(markup).toContain('aria-label="Email Example Lead in Gmail"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("action-primary");
    expect(markup).toContain("<a");
    expect(markup).not.toContain("<form");
  });

  it("opens Gmail without forcing an account when no mailbox is connected", () => {
    expect(gmailComposeUrl({
      recipient: "lead@example.com",
      accountAddress: null,
    })).toBe(
      "https://mail.google.com/mail/u/?view=cm&fs=1&to=lead%40example.com",
    );
  });

  it("does not render an action without a valid lead email", () => {
    expect(renderToStaticMarkup(
      <GmailComposeLink
        recipient={null}
        leadName="No Email"
        accountAddress="owner@example.com"
      />,
    )).toBe("");
    expect(gmailComposeUrl({
      recipient: "not-an-email",
      accountAddress: null,
    })).toBeNull();
  });

  it("is present on both the lead list and lead detail pages", () => {
    const listPage = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const detailPage = readFileSync(
      new URL("./[id]/page.tsx", import.meta.url),
      "utf8",
    );
    expect(listPage).toContain("<GmailComposeLink");
    expect(detailPage).toContain("<GmailComposeLink");
    expect(listPage).not.toContain("markLeadContactedAction");
    expect(detailPage).toContain("<MarkContactedButton");
    expect(listPage).toContain("recognized after the next Gmail check");
    expect(detailPage).toContain("recognized after the next Gmail check");
  });
});
