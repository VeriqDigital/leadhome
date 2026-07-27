import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  enqueue: vi.fn(),
  disconnect: vi.fn(),
  decryptToken: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/jobs/service", () => ({
  enqueueGmailSyncJob: mocks.enqueue,
  disconnectGmailAccount: mocks.disconnect,
}));
vi.mock("@/lib/gmail/token-crypto", () => ({
  decryptToken: mocks.decryptToken,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  disconnectGmailAction,
  syncGmailAction,
} from "./gmail-actions";

const accountId = "cm123456789012345678901234";

function form(value = accountId) {
  const data = new FormData();
  data.set("accountId", value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "owner-a" });
});

describe("Gmail sync enqueue action", () => {
  it("queues a job and returns canonical persisted job state", async () => {
    const job = {
      id: "job-a",
      communicationAccountId: accountId,
      type: "GMAIL_SYNC",
      status: "PENDING",
      active: true,
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: "2026-07-27T20:00:00.000Z",
      availableAt: "2026-07-27T20:00:00.000Z",
      startedAt: null,
      completedAt: null,
      failedAt: null,
      progress: null,
      result: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
    mocks.enqueue.mockResolvedValue({ kind: "queued", job });

    await expect(
      syncGmailAction({ success: false, message: "" }, form()),
    ).resolves.toEqual({
      success: true,
      message: "Gmail sync queued.",
      job,
    });
    expect(mocks.enqueue).toHaveBeenCalledWith("owner-a", accountId);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("returns the one existing active job for a duplicate submission", async () => {
    mocks.enqueue.mockResolvedValue({
      kind: "existing",
      job: { id: "job-active", status: "RUNNING" },
    });
    await expect(
      syncGmailAction({ success: false, message: "" }, form()),
    ).resolves.toEqual(expect.objectContaining({
      success: true,
      message: "The existing Gmail sync job is still active.",
      job: { id: "job-active", status: "RUNNING" },
    }));
  });

  it("rejects malformed and wrong-owner account identifiers safely", async () => {
    await expect(
      syncGmailAction({ success: false, message: "" }, form("forged")),
    ).resolves.toEqual({
      success: false,
      message: "Choose a valid Gmail connection.",
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();

    mocks.enqueue.mockResolvedValue({ kind: "not-found" });
    await expect(
      syncGmailAction({ success: false, message: "" }, form()),
    ).resolves.toEqual({
      success: false,
      message: "This Gmail connection is unavailable or needs reconnecting.",
    });
  });

  it("contains no provider or importer execution in the request path", () => {
    const source = String(syncGmailAction);
    expect(source).not.toContain("importProviderAccount");
    expect(source).not.toContain("GmailProvider");
  });
});

describe("Gmail disconnect action", () => {
  it("uses the coordinated local disconnect before redirecting", async () => {
    mocks.disconnect.mockResolvedValue({
      kind: "disconnected",
      encryptedRefreshToken: null,
      cancelled: 1,
      cancellationRequested: 1,
    });

    await disconnectGmailAction(form());

    expect(mocks.disconnect).toHaveBeenCalledWith("owner-a", accountId);
    expect(mocks.decryptToken).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/settings?gmail=disconnected",
    );
  });
});
