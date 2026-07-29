import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  begin: vi.fn(),
  generateAuthUrl: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/gmail/oauth-state", () => ({
  beginOAuthState: mocks.begin,
}));
vi.mock("@/lib/gmail/google-oauth", () => ({
  GMAIL_SCOPE: "https://www.googleapis.com/auth/gmail.readonly",
  googleOAuthClient: () => ({
    generateAuthUrl: mocks.generateAuthUrl,
  }),
}));

import { GET } from "./route";

const authorizationUrl =
  "https://accounts.google.test/o/oauth2/v2/auth?redacted=1";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner-a" } });
  mocks.begin.mockResolvedValue({
    kind: "accepted",
    state: "opaque-state",
  });
  mocks.generateAuthUrl.mockReturnValue(authorizationUrl);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("GET /api/gmail/connect", () => {
  it("creates one state and one authorization redirect", async () => {
    const response = await GET(
      new Request("https://leadhome.example/api/gmail/connect"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(authorizationUrl);
    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(mocks.begin).toHaveBeenCalledWith("owner-a");
    expect(mocks.generateAuthUrl).toHaveBeenCalledOnce();
    expect(mocks.generateAuthUrl).toHaveBeenCalledWith({
      access_type: "offline",
      include_granted_scopes: true,
      prompt: undefined,
      scope: ["https://www.googleapis.com/auth/gmail.readonly"],
      state: "opaque-state",
    });
  });

  it("preserves reconnect consent and blocks a rapid duplicate initiation", async () => {
    mocks.begin
      .mockResolvedValueOnce({
        kind: "accepted",
        state: "opaque-state",
      })
      .mockResolvedValueOnce({ kind: "duplicate" });

    const first = await GET(
      new Request(
        "https://leadhome.example/api/gmail/connect?reconnect=1",
      ),
    );
    const duplicate = await GET(
      new Request(
        "https://leadhome.example/api/gmail/connect?reconnect=1",
      ),
    );

    expect(first.headers.get("location")).toBe(authorizationUrl);
    expect(duplicate.headers.get("location")).toBe(
      "https://leadhome.example/settings?gmail=already-starting",
    );
    expect(mocks.generateAuthUrl).toHaveBeenCalledOnce();
    expect(mocks.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "consent" }),
    );
    expect(vi.mocked(console.info)).toHaveBeenLastCalledWith(
      "[LeadHome] Gmail OAuth",
      {
        event: "gmail_oauth_initiation",
        requestHost: "leadhome.example",
        requestPath: "/api/gmail/connect",
        accepted: false,
        duplicate: true,
      },
    );
  });

  it("does not create state for an unauthenticated request", async () => {
    mocks.auth.mockResolvedValueOnce(null);

    const response = await GET(
      new Request("https://leadhome.example/api/gmail/connect"),
    );

    expect(response.headers.get("location")).toBe(
      "https://leadhome.example/login",
    );
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
  });

  it("logs only safe initiation metadata", async () => {
    await GET(new Request("https://leadhome.example/api/gmail/connect"));

    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).toContain("gmail_oauth_initiation");
    expect(logs).not.toMatch(
      /opaque-state|accounts\.google|code_verifier|cookie|client_secret|access_token|refresh_token/i,
    );
  });
});
