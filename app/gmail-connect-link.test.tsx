import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GmailIntegrations } from "./settings/gmail-integrations";
import { GmailConnectLink } from "./gmail-connect-link";

vi.mock("@/app/inbox/gmail-sync-form", () => ({
  GmailSyncForm: () => null,
}));
vi.mock("./settings/disconnect-gmail-form", () => ({
  DisconnectGmailForm: () => null,
}));

const connectLinkSource = readFileSync(
  new URL("./gmail-connect-link.tsx", import.meta.url),
  "utf8",
);
const entryPointSources = [
  new URL("./settings/gmail-integrations.tsx", import.meta.url),
  new URL("./inbox/gmail-sync-form.tsx", import.meta.url),
  new URL("./inbox/page.tsx", import.meta.url),
].map((path) => readFileSync(path, "utf8"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gmail OAuth connect links", () => {
  it("renders Connect Gmail as a real custom OAuth href", () => {
    const markup = renderToStaticMarkup(
      <GmailConnectLink className="connect">Connect Gmail</GmailConnectLink>,
    );

    expect(markup).toContain('<a href="/api/gmail/connect"');
    expect(markup).toContain("Connect Gmail</a>");
    expect(markup).not.toContain("<button");
  });

  it("renders Reconnect Gmail as a real reconnect href", () => {
    const markup = renderToStaticMarkup(<GmailIntegrations accounts={[{
      id: "gmail-account",
      address: "owner@example.com",
      displayName: "Owner",
      status: "RECONNECT_REQUIRED",
      lastImportedAt: null,
      lastImportSummary: null,
      lastSyncError: null,
      latestJob: null,
    }]} />);

    expect(markup).toContain(
      '<a href="/api/gmail/connect?reconnect=1"',
    );
    expect(markup).toContain("Reconnect</a>");
  });

  it("uses browser-native navigation without Next Link or client JavaScript", () => {
    expect(connectLinkSource).toContain("<a");
    expect(connectLinkSource).toContain("href=");
    expect(connectLinkSource).not.toContain('"use client"');
    expect(connectLinkSource).not.toContain("next/link");
    expect(connectLinkSource).not.toContain("window.");
    expect(connectLinkSource).not.toContain("onClick");
  });

  it("does not request the OAuth route while rendering Settings", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const markup = renderToStaticMarkup(<GmailIntegrations accounts={[]} />);

    expect(markup).toContain('href="/api/gmail/connect"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses the anchor control at every Settings and Inbox entry point", () => {
    const [settings, syncForm, inbox] = entryPointSources;
    const allEntryPoints = entryPointSources.join("\n");

    expect(settings.match(/<GmailConnectLink/g)).toHaveLength(2);
    expect(syncForm.match(/<GmailConnectLink/g)).toHaveLength(1);
    expect(inbox.match(/<GmailConnectLink/g)).toHaveLength(2);
    expect(allEntryPoints).not.toContain("GmailConnectButton");
    expect(allEntryPoints).not.toMatch(
      /<Link[\s\S]{0,300}\/api\/gmail\/connect/,
    );
  });
});
