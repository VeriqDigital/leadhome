import { describe, expect, it, vi } from "vitest";
import { invokeWorker, readWorkerConfig } from "./jobs-worker.mjs";

const secret = "s".repeat(40);

describe("local jobs worker", () => {
  it("loads a bounded endpoint configuration without exposing the secret", () => {
    const config = readWorkerConfig({
      JOB_RUNNER_SECRET: secret,
      JOB_RUNNER_URL: "https://example.test/api/internal/jobs/run",
      JOB_WORKER_POLL_INTERVAL_MS: "2500",
      JOB_RUN_TIME_BUDGET_MS: "10000",
    });

    expect(config).toEqual({
      endpoint: "https://example.test/api/internal/jobs/run",
      secret,
      pollIntervalMs: 2500,
      requestTimeoutMs: 25000,
    });
    expect(JSON.stringify({
      endpoint: config.endpoint,
      pollIntervalMs: config.pollIntervalMs,
    })).not.toContain(secret);
  });

  it("rejects missing, weak, or unbounded settings", () => {
    expect(() => readWorkerConfig({})).toThrow("at least 40");
    expect(() =>
      readWorkerConfig({
        JOB_RUNNER_SECRET: "short",
      }),
    ).toThrow("at least 40");
    expect(() =>
      readWorkerConfig({
        JOB_RUNNER_SECRET: secret,
        JOB_WORKER_POLL_INTERVAL_MS: "50",
      }),
    ).toThrow("JOB_WORKER_POLL_INTERVAL_MS");
    expect(() =>
      readWorkerConfig({
        JOB_RUNNER_SECRET: ` ${secret}`,
      }),
    ).toThrow("surrounding whitespace");
  });

  it("requires confidential, credential-free remote worker URLs", () => {
    expect(() =>
      readWorkerConfig({
        JOB_RUNNER_SECRET: secret,
        JOB_RUNNER_URL: "http://example.test/api/internal/jobs/run",
      }),
    ).toThrow("https for non-loopback");
    expect(() =>
      readWorkerConfig({
        JOB_RUNNER_SECRET: secret,
        JOB_RUNNER_URL: "http://127.attacker.test/api/internal/jobs/run",
      }),
    ).toThrow("https for non-loopback");
    expect(() =>
      readWorkerConfig({
        JOB_RUNNER_SECRET: secret,
        JOB_RUNNER_URL:
          "https://user:password@example.test/api/internal/jobs/run",
      }),
    ).toThrow("username or password");
    expect(() =>
      readWorkerConfig({
        JOB_RUNNER_SECRET: secret,
        JOB_RUNNER_URL:
          "https://example.test/api/internal/jobs/run?secret=unsafe",
      }),
    ).toThrow("query string or fragment");

    expect(
      readWorkerConfig({
        JOB_RUNNER_SECRET: secret,
        JOB_RUNNER_URL: "http://127.0.0.1:3000/api/internal/jobs/run",
      }).endpoint,
    ).toBe("http://127.0.0.1:3000/api/internal/jobs/run");
  });

  it("invokes the protected production endpoint with a bearer secret", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        claimed: 1,
        completed: 1,
        retried: 0,
        failed: 0,
      }),
    );
    const result = await invokeWorker(
      {
        endpoint: "https://example.test/api/internal/jobs/run",
        secret,
        pollIntervalMs: 5000,
        requestTimeoutMs: 1000,
      },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/api/internal/jobs/run",
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${secret}`,
        },
      }),
    );
    expect(result).toEqual(expect.objectContaining({ completed: 1 }));
  });

  it("returns only the endpoint's bounded error message", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { error: "Worker invocation failed.", internal: "must not be printed" },
        { status: 500 },
      ),
    );

    await expect(
      invokeWorker(
        {
          endpoint: "https://example.test/api/internal/jobs/run",
          secret,
          pollIntervalMs: 5000,
          requestTimeoutMs: 1000,
        },
        { fetchImpl },
      ),
    ).rejects.toThrow("Worker invocation failed.");
  });
});
