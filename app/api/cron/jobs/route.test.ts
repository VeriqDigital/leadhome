import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock("@/lib/jobs/runner", () => ({
  runJobInvocation: mocks.run,
}));

import {
  CRON_MAX_JOBS,
  CRON_TIME_BUDGET_MS,
  GET,
  maxDuration,
  runtime,
} from "./route";

const secret = "cron-secret-".padEnd(64, "x");

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/jobs", {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

function invocationStats(overrides: Record<string, unknown> = {}) {
  return {
    claimed: 0,
    completed: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    leaseLost: 0,
    staleRecovered: 0,
    purged: 0,
    stoppedReason: "queue_empty",
    stoppedForTimeBudget: false,
    durationMs: 8,
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", secret);
  mocks.run.mockReset();
  mocks.run.mockResolvedValue(invocationStats());
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/cron/jobs", () => {
  it("uses the Node.js runtime and a five-minute function limit", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(300);
  });

  it("rejects a missing CRON_SECRET without invoking the runner", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request(`Bearer ${secret}`));

    expect(response.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rejects missing and incorrect Authorization without invoking the runner", async () => {
    const missing = await GET(request());
    const incorrect = await GET(request("Bearer incorrect"));
    const browserSession = await GET(
      new Request("http://localhost/api/cron/jobs", {
        headers: { Cookie: "authjs.session-token=browser-session" },
      }),
    );

    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
    expect(browserSession.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("runs one sequential bounded invocation for the exact bearer secret", async () => {
    mocks.run.mockResolvedValueOnce(
      invocationStats({
        claimed: 2,
        completed: 1,
        retried: 1,
        stoppedReason: "queue_empty",
      }),
    );
    const cronRequest = request(`Bearer ${secret}`);

    const response = await GET(cronRequest);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(CRON_MAX_JOBS).toBe(10);
    expect(CRON_TIME_BUDGET_MS).toBe(240_000);
    expect(mocks.run).toHaveBeenCalledWith({
      workerId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      maxJobs: 10,
      timeBudgetMs: 240_000,
      signal: cronRequest.signal,
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      claimed: 2,
      completed: 1,
      retried: 1,
      failed: 0,
      cancelled: 0,
      leaseLost: 0,
      staleRecovered: 0,
      purged: 0,
      stoppedReason: "queue_empty",
      durationMs: 8,
    });
  });

  it("returns 200 and zero counts when the queue is empty", async () => {
    const response = await GET(request(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        claimed: 0,
        completed: 0,
        failed: 0,
        stoppedReason: "queue_empty",
      }),
    );
  });

  it("never includes runner payloads, secrets, or diagnostics in its response or logs", async () => {
    mocks.run.mockResolvedValueOnce(
      invocationStats({
        payload: { accessToken: "provider-secret", body: "private email" },
        internalError: "database diagnostics",
      }),
    );

    const response = await GET(request(`Bearer ${secret}`));
    const serializedResponse = JSON.stringify(await response.json());
    const serializedLogs = JSON.stringify([
      vi.mocked(console.info).mock.calls,
      vi.mocked(console.error).mock.calls,
    ]);

    expect(serializedResponse).not.toMatch(
      /provider-secret|private email|database diagnostics|accessToken|payload/i,
    );
    expect(serializedLogs).not.toContain(secret);
    expect(serializedLogs).not.toMatch(
      /provider-secret|private email|database diagnostics|accessToken|payload/i,
    );
  });

  it("returns a safe structured failure when the runner throws", async () => {
    mocks.run.mockRejectedValueOnce(
      new Error("database error containing private job data"),
    );

    const response = await GET(request(`Bearer ${secret}`));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Job invocation failed.",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private job data",
    );
  });
});
