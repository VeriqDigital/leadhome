import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  latest: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/jobs/service", () => ({
  getLatestGmailSyncJob: mocks.latest,
}));
vi.mock("@/lib/server-errors", () => ({
  reportOperationalError: mocks.reportError,
}));

import { GET } from "./route";

const accountId = "clv6o9u8u0000t9t9f8k3g2h1";
const foreignAccountId = "clv6o9u8u0001t9t9f8k3g2h2";

function request(id = accountId) {
  return new Request(
    `http://localhost/api/jobs/status?accountId=${encodeURIComponent(id)}`,
  );
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.latest.mockReset();
  mocks.reportError.mockReset();
  mocks.auth.mockResolvedValue({ user: { id: "owner-a" } });
  mocks.latest.mockResolvedValue(null);
});

describe("GET /api/jobs/status", () => {
  it("requires a browser-authenticated owner", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.latest).not.toHaveBeenCalled();
  });

  it("rejects a missing or forged communication account ID", async () => {
    const missing = await GET(
      new Request("http://localhost/api/jobs/status"),
    );
    const forged = await GET(request("another-owner-account"));

    expect(missing.status).toBe(400);
    expect(forged.status).toBe(400);
    expect(mocks.latest).not.toHaveBeenCalled();
  });

  it("returns only the latest owner-scoped public Gmail job view", async () => {
    const view = {
      id: "job-a",
      communicationAccountId: accountId,
      status: "RUNNING",
      progress: {
        phase: "IMPORTING_THREADS",
        processed: 10,
        total: 20,
        percent: 50,
        message: "Importing Gmail conversations.",
      },
      result: null,
      attemptCount: 1,
      maxAttempts: 3,
      active: true,
      createdAt: "2026-07-27T12:00:00.000Z",
      availableAt: "2026-07-27T12:00:00.000Z",
      startedAt: "2026-07-27T12:00:01.000Z",
      completedAt: null,
      failedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
    mocks.latest.mockResolvedValueOnce(view);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.latest).toHaveBeenCalledWith("owner-a", accountId);
    await expect(response.json()).resolves.toEqual({ job: view });
  });

  it("does not expose another owner's job", async () => {
    mocks.latest.mockResolvedValueOnce(null);
    const response = await GET(request(foreignAccountId));

    expect(mocks.latest).toHaveBeenCalledWith("owner-a", foreignAccountId);
    await expect(response.json()).resolves.toEqual({ job: null });
  });

  it("stores no internal failure details in the response", async () => {
    mocks.latest.mockRejectedValueOnce(
      new Error("query failed with encrypted credential metadata"),
    );
    const response = await GET(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Gmail sync status is unavailable.",
    });
    expect(mocks.reportError).toHaveBeenCalled();
  });
});
