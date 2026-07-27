import { beforeEach, describe, expect, it, vi } from "vitest";

type RefreshedTokens = {
  access_token?: string | null;
  expiry_date?: number | null;
};

const mocks = vi.hoisted(() => ({
  findAccount: vi.fn(),
  updateAccount: vi.fn(),
  updateCredential: vi.fn(),
  setCredentials: vi.fn(),
  on: vi.fn(),
  gmail: vi.fn(),
  tokenListener: null as ((tokens: RefreshedTokens) => void) | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("googleapis", () => ({
  google: { gmail: mocks.gmail },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationAccount: {
      findFirst: mocks.findAccount,
      updateMany: mocks.updateAccount,
    },
    gmailCredential: {
      updateMany: mocks.updateCredential,
    },
  },
}));
vi.mock("./google-oauth", () => ({
  googleOAuthClient: () => ({
    setCredentials: mocks.setCredentials,
    on: mocks.on,
  }),
}));
vi.mock("./token-crypto", () => ({
  decryptToken: (value: string) => `decrypted:${value}`,
  encryptToken: (value: string) => `encrypted:${value}`,
}));

import { createGmailClient } from "./gmail-client";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tokenListener = null;
  mocks.findAccount.mockResolvedValue({
    id: "account-a",
    ownerId: "owner-a",
    provider: "GMAIL",
    status: "CONNECTED",
    tokenExpiresAt: null,
    gmailCredential: {
      encryptedRefreshToken: "stored-refresh",
      encryptedAccessToken: "stored-access",
    },
  });
  mocks.updateAccount.mockResolvedValue({ count: 1 });
  mocks.updateCredential.mockResolvedValue({ id: "credential-a" });
  mocks.gmail.mockReturnValue({ users: { threads: {} } });
  mocks.on.mockImplementation(
    (event: string, listener: (tokens: RefreshedTokens) => void) => {
      if (event === "tokens") mocks.tokenListener = listener;
    },
  );
});

describe("Gmail OAuth token persistence", () => {
  it("persists refreshed token metadata for the owned account", async () => {
    await createGmailClient("account-a", "owner-a");
    expect(mocks.tokenListener).not.toBeNull();

    mocks.tokenListener?.({
      access_token: "new-access",
      expiry_date: Date.parse("2026-07-28T12:00:00.000Z"),
    });

    await vi.waitFor(() => {
      expect(mocks.updateCredential).toHaveBeenCalledWith({
        where: { communicationAccountId: "account-a" },
        data: { encryptedAccessToken: "encrypted:new-access" },
      });
    });
    expect(mocks.updateAccount).toHaveBeenCalledWith({
      where: {
        id: "account-a",
        ownerId: "owner-a",
        status: "CONNECTED",
      },
      data: { tokenExpiresAt: new Date("2026-07-28T12:00:00.000Z") },
    });
  });

  it("does not restore a token after the account was disconnected", async () => {
    mocks.updateAccount.mockResolvedValueOnce({ count: 0 });
    await createGmailClient("account-a", "owner-a");

    mocks.tokenListener?.({
      access_token: "late-access",
      expiry_date: Date.now(),
    });

    await vi.waitFor(() => {
      expect(mocks.updateAccount).toHaveBeenCalled();
    });
    expect(mocks.updateCredential).not.toHaveBeenCalled();
  });

  it("contains persistence failures and logs no token or database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updateAccount.mockRejectedValueOnce(
      new Error("database failure containing new-access-secret"),
    );
    await createGmailClient("account-a", "owner-a");

    const callbackResult = mocks.tokenListener?.({
      access_token: "new-access-secret",
      expiry_date: Date.now(),
    });
    expect(callbackResult).toBeUndefined();

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "[LeadHome] persist Gmail token refresh failed",
        { name: "Error" },
      );
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "new-access-secret",
    );
    consoleError.mockRestore();
  });
});
