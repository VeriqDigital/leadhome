import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  consumeState: vi.fn(),
  oauthClient: vi.fn(),
  getToken: vi.fn(),
  setCredentials: vi.fn(),
  gmailProfile: vi.fn(),
  findAccount: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  upsertCredential: vi.fn(),
  transaction: vi.fn(),
  encryptToken: vi.fn(),
  consoleInfo: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/gmail/oauth-state", () => ({
  consumeOAuthState: mocks.consumeState,
}));
vi.mock("@/lib/gmail/google-oauth", () => ({
  googleOAuthClient: mocks.oauthClient,
}));
vi.mock("@/lib/gmail/token-crypto", () => ({
  encryptToken: mocks.encryptToken,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    communicationAccount: {
      findFirst: mocks.findAccount,
    },
  },
}));
vi.mock("googleapis", () => ({
  google: {
    gmail: () => ({
      users: { getProfile: mocks.gmailProfile },
    }),
  },
}));

import { GET } from "./route";

const callbackUrl =
  "https://leadhome.example/api/gmail/callback?state=opaque-state&code=authorization-code";
const refreshToken = "refresh-token-secret";
const accessToken = "access-token-secret";

function existingAccount(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "gmail-account-a",
    ownerId: "owner-a",
    provider: "GMAIL",
    providerAccountId: "legacy-google-subject-a",
    displayName: "Owner mailbox",
    address: "owner@example.com",
    status: "RECONNECT_REQUIRED",
    grantedScopes: "https://www.googleapis.com/auth/gmail.readonly",
    gmailCredential: {
      encryptedRefreshToken: "existing-encrypted-refresh-token",
      encryptedAccessToken: "existing-encrypted-access-token",
    },
    ...overrides,
  };
}

function location(response: Response) {
  return response.headers.get("location");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(mocks.consoleInfo);
  mocks.auth.mockResolvedValue({ user: { id: "owner-a" } });
  mocks.consumeState.mockResolvedValue({
    kind: "consumed",
    stateExisted: true,
  });
  mocks.oauthClient.mockReturnValue({
    getToken: mocks.getToken,
    setCredentials: mocks.setCredentials,
  });
  mocks.getToken.mockResolvedValue({
    tokens: {
      refresh_token: refreshToken,
      access_token: accessToken,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      expiry_date: Date.parse("2026-07-29T20:00:00.000Z"),
    },
  });
  mocks.gmailProfile.mockResolvedValue({
    data: { emailAddress: "Owner@Example.com" },
  });
  mocks.findAccount.mockResolvedValue(null);
  mocks.createAccount.mockResolvedValue({ id: "gmail-account-a" });
  mocks.updateAccount.mockResolvedValue({ count: 1 });
  mocks.upsertCredential.mockResolvedValue({ id: "credential-a" });
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      communicationAccount: {
        create: mocks.createAccount,
        updateMany: mocks.updateAccount,
      },
      gmailCredential: { upsert: mocks.upsertCredential },
    }),
  );
  mocks.encryptToken.mockImplementation((value: string) =>
    value === refreshToken
      ? "encrypted-refresh-token"
      : "encrypted-access-token",
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/gmail/callback", () => {
  it("persists a successful first-time Gmail connection atomically", async () => {
    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=connected",
    );
    expect(mocks.consumeState).toHaveBeenCalledWith(
      "opaque-state",
      "owner-a",
    );
    expect(mocks.getToken).toHaveBeenCalledWith("authorization-code");
    expect(mocks.gmailProfile).toHaveBeenCalledWith({ userId: "me" });
    expect(mocks.findAccount).toHaveBeenCalledWith({
      where: {
        provider: "GMAIL",
        OR: [
          { providerAccountId: "owner@example.com" },
          {
            address: {
              equals: "owner@example.com",
              mode: "insensitive",
            },
          },
        ],
      },
      include: { gmailCredential: true },
    });
    expect(mocks.createAccount).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: "owner-a",
        provider: "GMAIL",
        providerAccountId: "owner@example.com",
        address: "owner@example.com",
      }),
    });
    expect(mocks.upsertCredential).toHaveBeenCalledWith({
      where: { communicationAccountId: "gmail-account-a" },
      create: {
        communicationAccountId: "gmail-account-a",
        encryptedRefreshToken: "encrypted-refresh-token",
        encryptedAccessToken: "encrypted-access-token",
      },
      update: {
        encryptedRefreshToken: "encrypted-refresh-token",
        encryptedAccessToken: "encrypted-access-token",
      },
    });
  });

  it("updates only the owner-scoped mailbox on reconnect", async () => {
    mocks.findAccount.mockResolvedValueOnce(existingAccount());

    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=connected",
    );
    expect(mocks.createAccount).not.toHaveBeenCalled();
    expect(mocks.updateAccount).toHaveBeenCalledWith({
      where: {
        id: "gmail-account-a",
        ownerId: "owner-a",
        provider: "GMAIL",
      },
      data: expect.objectContaining({
        address: "owner@example.com",
        status: "CONNECTED",
        disconnectedAt: null,
        lastSyncError: null,
      }),
    });
    expect(mocks.upsertCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { communicationAccountId: "gmail-account-a" },
      }),
    );
  });

  it("rejects a callback with no state before token exchange", async () => {
    const response = await GET(
      new Request(
        "https://leadhome.example/api/gmail/callback?code=authorization-code",
      ),
    );

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=invalid",
    );
    expect(mocks.consumeState).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.consoleInfo).toHaveBeenCalledWith(
      "[LeadHome] Gmail OAuth",
      expect.objectContaining({
        callbackStage: "request_validation",
        reasonCode: "callback_parameters_missing",
        stateExisted: false,
      }),
    );
  });

  it("reports an expired state distinctly and does not exchange the code", async () => {
    mocks.consumeState.mockResolvedValueOnce({
      kind: "invalid",
      reasonCode: "state_expired",
      stateExisted: true,
    });

    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=invalid",
    );
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.consoleInfo).toHaveBeenCalledWith(
      "[LeadHome] Gmail OAuth",
      expect.objectContaining({
        callbackStage: "state_validation",
        reasonCode: "state_expired",
        stateExisted: true,
      }),
    );
  });

  it("returns a temporary-provider result when token exchange fails", async () => {
    mocks.getToken.mockRejectedValueOnce(new TypeError("provider failed"));

    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=provider",
    );
    expect(mocks.gmailProfile).not.toHaveBeenCalled();
    expect(mocks.consoleInfo).toHaveBeenCalledWith(
      "[LeadHome] Gmail OAuth",
      expect.objectContaining({
        callbackStage: "token_exchange",
        reasonCode: "token_exchange_failed",
        safeErrorClass: "TypeError",
      }),
    );
  });

  it("requires offline access for a first-time mailbox", async () => {
    mocks.getToken.mockResolvedValueOnce({
      tokens: { access_token: accessToken },
    });

    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=refresh",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.consoleInfo).toHaveBeenCalledWith(
      "[LeadHome] Gmail OAuth",
      expect.objectContaining({
        callbackStage: "refresh_token_validation",
        reasonCode: "offline_refresh_token_missing",
        refreshTokenPresent: false,
      }),
    );
  });

  it("returns a temporary-provider result when Gmail profile lookup fails", async () => {
    mocks.gmailProfile.mockRejectedValueOnce(new Error("gmail unavailable"));

    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=provider",
    );
    expect(mocks.findAccount).not.toHaveBeenCalled();
    expect(mocks.consoleInfo).toHaveBeenCalledWith(
      "[LeadHome] Gmail OAuth",
      expect.objectContaining({
        callbackStage: "mailbox_profile_lookup",
        reasonCode: "gmail_profile_lookup_failed",
      }),
    );
  });

  it("does not overwrite a mailbox already connected to this workspace", async () => {
    mocks.findAccount.mockResolvedValueOnce(
      existingAccount({ status: "CONNECTED" }),
    );

    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=already-connected",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not allow a mailbox connected to another workspace", async () => {
    mocks.findAccount.mockResolvedValueOnce(
      existingAccount({ ownerId: "owner-b", status: "CONNECTED" }),
    );

    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=conflict",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.consoleInfo).toHaveBeenCalledWith(
      "[LeadHome] Gmail OAuth",
      expect.objectContaining({
        callbackStage: "mailbox_validation",
        reasonCode: "mailbox_owned_elsewhere",
        mailboxRecordExisted: true,
      }),
    );
  });

  it("returns a configuration result when encryption fails", async () => {
    mocks.encryptToken.mockImplementationOnce(() => {
      throw new Error("encryption unavailable");
    });

    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=configuration",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.consoleInfo).toHaveBeenCalledWith(
      "[LeadHome] Gmail OAuth",
      expect.objectContaining({
        callbackStage: "token_encryption",
        reasonCode: "token_encryption_failed",
      }),
    );
  });

  it("returns a persistence result when the transaction fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=persistence",
    );
    expect(mocks.consoleInfo).toHaveBeenCalledWith(
      "[LeadHome] Gmail OAuth",
      expect.objectContaining({
        callbackStage: "database_persistence",
        reasonCode: "mailbox_persistence_failed",
        persistenceSucceeded: false,
      }),
    );
  });

  it("contains unexpected callback failures behind a safe result", async () => {
    mocks.auth.mockRejectedValueOnce(new Error("unexpected auth failure"));

    const response = await GET(new Request(callbackUrl));

    expect(location(response)).toBe(
      "https://leadhome.example/settings?gmail=unexpected",
    );
    expect(mocks.consoleInfo).toHaveBeenCalledWith(
      "[LeadHome] Gmail OAuth",
      expect.objectContaining({
        callbackStage: "unexpected_failure",
        reasonCode: "unexpected_callback_failure",
        safeErrorClass: "Error",
      }),
    );
  });

  it("never writes OAuth credentials or provider error details to logs", async () => {
    const providerPayload =
      "authorization-code access-token-secret refresh-token-secret client-secret encryption-key cookie-value";
    mocks.getToken.mockRejectedValueOnce(new Error(providerPayload));

    await GET(new Request(callbackUrl));

    const serializedLogs = JSON.stringify(mocks.consoleInfo.mock.calls);
    expect(serializedLogs).not.toContain("authorization-code");
    expect(serializedLogs).not.toContain("access-token-secret");
    expect(serializedLogs).not.toContain("refresh-token-secret");
    expect(serializedLogs).not.toContain("client-secret");
    expect(serializedLogs).not.toContain("encryption-key");
    expect(serializedLogs).not.toContain("cookie-value");
    expect(serializedLogs).not.toContain(providerPayload);
  });
});
