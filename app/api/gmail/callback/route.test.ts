import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  consumeState: vi.fn(),
  getToken: vi.fn(),
  setCredentials: vi.fn(),
  userinfo: vi.fn(),
  findAccount: vi.fn(),
  upsertAccount: vi.fn(),
  upsertCredential: vi.fn(),
  encryptToken: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/gmail/oauth-state", () => ({
  consumeOAuthState: mocks.consumeState,
}));
vi.mock("@/lib/gmail/google-oauth", () => ({
  googleOAuthClient: () => ({
    getToken: mocks.getToken,
    setCredentials: mocks.setCredentials,
  }),
}));
vi.mock("@/lib/gmail/token-crypto", () => ({
  encryptToken: mocks.encryptToken,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationAccount: {
      findUnique: mocks.findAccount,
      upsert: mocks.upsertAccount,
    },
    gmailCredential: {
      upsert: mocks.upsertCredential,
    },
  },
}));
vi.mock("googleapis", () => ({
  google: {
    oauth2: () => ({
      userinfo: { get: mocks.userinfo },
    }),
  },
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner-a" } });
  mocks.consumeState.mockResolvedValue(undefined);
  mocks.getToken.mockResolvedValue({
    tokens: {
      refresh_token: "refresh-token",
      access_token: "access-token",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      expiry_date: Date.parse("2026-07-29T20:00:00.000Z"),
    },
  });
  mocks.userinfo.mockResolvedValue({
    data: {
      id: "google-account-a",
      email: "owner@example.com",
      name: "Owner",
    },
  });
  mocks.findAccount.mockResolvedValue(null);
  mocks.upsertAccount.mockResolvedValue({ id: "gmail-account-a" });
  mocks.upsertCredential.mockResolvedValue({ id: "credential-a" });
  mocks.encryptToken.mockImplementation((value: string) => `encrypted:${value}`);
});

describe("GET /api/gmail/callback", () => {
  it("consumes state and preserves the Gmail token-storage flow", async () => {
    const response = await GET(
      new Request(
        "https://leadhome.example/api/gmail/callback?state=opaque-state&code=authorization-code",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://leadhome.example/settings?gmail=connected",
    );
    expect(mocks.consumeState).toHaveBeenCalledWith(
      "opaque-state",
      "owner-a",
    );
    expect(mocks.getToken).toHaveBeenCalledWith("authorization-code");
    expect(mocks.upsertAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId_provider_providerAccountId: {
            ownerId: "owner-a",
            provider: "GMAIL",
            providerAccountId: "google-account-a",
          },
        },
      }),
    );
    expect(mocks.upsertCredential).toHaveBeenCalledWith({
      where: { communicationAccountId: "gmail-account-a" },
      create: {
        communicationAccountId: "gmail-account-a",
        encryptedRefreshToken: "encrypted:refresh-token",
        encryptedAccessToken: "encrypted:access-token",
      },
      update: {
        encryptedRefreshToken: "encrypted:refresh-token",
        encryptedAccessToken: "encrypted:access-token",
      },
    });
  });

  it("does not exchange or store tokens when state validation fails", async () => {
    mocks.consumeState.mockRejectedValueOnce(new Error("invalid state"));

    const response = await GET(
      new Request(
        "https://leadhome.example/api/gmail/callback?state=invalid&code=authorization-code",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://leadhome.example/settings?gmail=error",
    );
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.upsertCredential).not.toHaveBeenCalled();
  });
});
