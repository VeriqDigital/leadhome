import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/jobs/runner", () => ({
  runJobInvocation: mocks.run,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server-errors", () => ({
  reportOperationalError: mocks.reportError,
}));

import { POST } from "./route";

const secret = "worker-secret-".padEnd(40, "x");

function request(authorization?: string) {
  return new Request("http://localhost/api/internal/jobs/run", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : undefined,
    body: JSON.stringify({
      type: "FORGED_JOB_TYPE",
      payload: { encryptedRefreshToken: "must-be-ignored" },
    }),
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("JOB_RUNNER_SECRET", secret);
  vi.stubEnv("JOBS_PER_RUN", "2");
  vi.stubEnv("JOB_RUN_TIME_BUDGET_MS", "12000");
  mocks.run.mockReset();
  mocks.reportError.mockReset();
  mocks.run.mockResolvedValue({
    claimed: 1,
    completed: 1,
    retried: 0,
    failed: 0,
    cancelled: 0,
    leaseLost: 0,
    staleRecovered: 0,
    purged: 0,
    stoppedForTimeBudget: false,
    durationMs: 10,
  });
});

describe("POST /api/internal/jobs/run", () => {
  it("rejects missing and incorrect worker secrets without running jobs", async () => {
    const missing = await POST(request());
    const incorrect = await POST(request("Bearer incorrect"));
    const browserOnly = await POST(
      new Request("http://localhost/api/internal/jobs/run", {
        method: "POST",
        headers: { Cookie: "authjs.session-token=browser-session" },
      }),
    );

    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
    expect(browserOnly.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("fails closed when the server secret is missing or weak", async () => {
    vi.stubEnv("JOB_RUNNER_SECRET", "");
    expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);

    vi.stubEnv("JOB_RUNNER_SECRET", "too-short");
    expect((await POST(request("Bearer too-short"))).status).toBe(503);

    vi.stubEnv("JOB_RUNNER_SECRET", ` ${secret}`);
    expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("uses a unique worker lease and bounded invocation configuration", async () => {
    const response = await POST(request(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.run).toHaveBeenCalledWith({
      workerId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      maxJobs: 2,
      timeBudgetMs: 12000,
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      claimed: 1,
      completed: 1,
      retried: 0,
      failed: 0,
      cancelled: 0,
      leaseLost: 0,
      staleRecovered: 0,
      purged: 0,
      stoppedForTimeBudget: false,
      durationMs: 10,
    });
  });

  it("does not accept request payloads as job or execution configuration", async () => {
    await POST(request(`Bearer ${secret}`));

    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0][0]).not.toHaveProperty("type");
    expect(mocks.run.mock.calls[0][0]).not.toHaveProperty("payload");
    expect(JSON.stringify(mocks.run.mock.calls[0][0])).not.toContain(
      "encryptedRefreshToken",
    );
  });

  it("falls back to safe bounds for invalid environment limits", async () => {
    vi.stubEnv("JOBS_PER_RUN", "100000");
    vi.stubEnv("JOB_RUN_TIME_BUDGET_MS", "1");

    await POST(request(`Bearer ${secret}`));

    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        maxJobs: 3,
        timeBudgetMs: 45000,
      }),
    );
  });

  it("returns a safe error without exposing worker diagnostics", async () => {
    mocks.run.mockRejectedValueOnce(
      new Error("database error containing sensitive provider data"),
    );
    const response = await POST(request(`Bearer ${secret}`));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Worker invocation failed.",
    });
    expect(mocks.reportError).toHaveBeenCalledWith(
      "job worker invocation failed",
      expect.any(Error),
    );
  });
});
