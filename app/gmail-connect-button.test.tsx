import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  GmailConnectButton,
  startSingleFlightOAuthNavigation,
} from "./gmail-connect-button";

describe("Gmail OAuth connect control", () => {
  it("does not initiate OAuth while rendering", () => {
    const markup = renderToStaticMarkup(
      <GmailConnectButton className="connect">Connect Gmail</GmailConnectButton>,
    );

    expect(markup).toContain("<button");
    expect(markup).toContain("Connect Gmail");
    expect(markup).not.toContain("/api/gmail/connect");
    expect(markup).not.toContain("href=");
  });

  it("starts exactly one full navigation for one click", () => {
    const started = { current: false };
    const navigate = vi.fn();

    expect(
      startSingleFlightOAuthNavigation(
        started,
        navigate,
        "/api/gmail/connect",
      ),
    ).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/api/gmail/connect");
  });

  it("blocks repeated rapid navigation attempts synchronously", () => {
    const started = { current: false };
    const navigate = vi.fn();

    for (let click = 0; click < 5; click += 1) {
      startSingleFlightOAuthNavigation(
        started,
        navigate,
        "/api/gmail/connect?reconnect=1",
      );
    }

    expect(navigate).toHaveBeenCalledOnce();
  });

  it("keeps every connect endpoint out of prefetchable Next.js Links", () => {
    const sources = [
      "app/gmail-connect-button.tsx",
      "app/settings/gmail-integrations.tsx",
      "app/inbox/gmail-sync-form.tsx",
      "app/inbox/page.tsx",
    ].map((path) => readFileSync(path, "utf8"));

    expect(sources.join("\n")).not.toMatch(
      /<Link[\s\S]{0,300}href=["{][^]*?\/api\/gmail\/connect/,
    );
    expect(sources[0]).not.toContain('from "next/link"');
    expect(sources[0]).toContain("window.location.assign");
  });
});
