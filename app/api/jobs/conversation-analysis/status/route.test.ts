import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getJob: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/jobs/service", () => ({
  getConversationAnalysisJob: mocks.getJob,
}));
vi.mock("@/lib/server-errors", () => ({
  reportOperationalError: mocks.reportError,
}));

import { GET } from "./route";

const jobId = "clv6o9u8u0000t9t9f8k3g2h1";
const foreignJobId = "clv6o9u8u0001t9t9f8k3g2h2";

function request(id = jobId) {
  return new Request(
    `http://localhost/api/jobs/conversation-analysis/status?jobId=${encodeURIComponent(id)}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner-a" } });
  mocks.getJob.mockResolvedValue(null);
});

describe("GET /api/jobs/conversation-analysis/status", () => {
  it("requires a browser-authenticated owner", async () => {
    mocks.auth.mockResolvedValueOnce(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.getJob).not.toHaveBeenCalled();
  });

  it("rejects missing or malformed job IDs", async () => {
    const missing = await GET(
      new Request(
        "http://localhost/api/jobs/conversation-analysis/status",
      ),
    );
    const malformed = await GET(request("not-a-job"));

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(mocks.getJob).not.toHaveBeenCalled();
  });

  it("returns only the owner-scoped public analysis job view", async () => {
    const view = {
      id: jobId,
      type: "CONVERSATION_ANALYSIS",
      status: "RUNNING",
      progress: {
        phase: "ANALYZING",
        processed: 1,
        total: 3,
        percent: 33,
        message: "Analyzing conversation.",
      },
      result: null,
      attemptCount: 1,
      maxAttempts: 3,
      availableAt: "2026-07-27T12:00:00.000Z",
      queuedAt: "2026-07-27T12:00:00.000Z",
      startedAt: "2026-07-27T12:00:01.000Z",
      completedAt: null,
      failedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: "2026-07-27T12:00:02.000Z",
      active: true,
    };
    mocks.getJob.mockResolvedValueOnce(view);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getJob).toHaveBeenCalledWith("owner-a", jobId);
    await expect(response.json()).resolves.toEqual({ job: view });
    expect(view).not.toHaveProperty("payload");
  });

  it("does not expose another owner's job", async () => {
    const response = await GET(request(foreignJobId));

    expect(mocks.getJob).toHaveBeenCalledWith("owner-a", foreignJobId);
    await expect(response.json()).resolves.toEqual({ job: null });
  });

  it("returns a bounded error without internal diagnostics", async () => {
    mocks.getJob.mockRejectedValueOnce(
      new Error("query failed with private model request details"),
    );

    const response = await GET(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Conversation analysis status is unavailable.",
    });
    expect(mocks.reportError).toHaveBeenCalled();
  });
});
