import { pathToFileURL } from "node:url";

const DEFAULT_ENDPOINT = "http://localhost:3000/api/internal/jobs/run";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MINIMUM_SECRET_LENGTH = 40;

function integerSetting(value, fallback, { minimum, maximum, name }) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function readWorkerConfig(environment = process.env) {
  const secret = environment.JOB_RUNNER_SECRET;
  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `JOB_RUNNER_SECRET must contain at least ${MINIMUM_SECRET_LENGTH} characters.`,
    );
  }
  if (secret !== secret.trim()) {
    throw new Error("JOB_RUNNER_SECRET must not contain surrounding whitespace.");
  }

  const endpoint = new URL(environment.JOB_RUNNER_URL || DEFAULT_ENDPOINT);
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("JOB_RUNNER_URL must use http or https.");
  }
  if (endpoint.username || endpoint.password) {
    throw new Error("JOB_RUNNER_URL must not contain username or password credentials.");
  }
  if (endpoint.search || endpoint.hash) {
    throw new Error("JOB_RUNNER_URL must not contain a query string or fragment.");
  }
  const isLoopback =
    endpoint.hostname === "localhost" ||
    endpoint.hostname === "::1" ||
    endpoint.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(endpoint.hostname);
  if (endpoint.protocol === "http:" && !isLoopback) {
    throw new Error("JOB_RUNNER_URL must use https for non-loopback hosts.");
  }

  return {
    endpoint: endpoint.toString(),
    secret,
    pollIntervalMs: integerSetting(
      environment.JOB_WORKER_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      {
        minimum: 1_000,
        maximum: 300_000,
        name: "JOB_WORKER_POLL_INTERVAL_MS",
      },
    ),
    requestTimeoutMs:
      integerSetting(
        environment.JOB_RUN_TIME_BUDGET_MS,
        45_000,
        {
          minimum: 1_000,
          maximum: 55_000,
          name: "JOB_RUN_TIME_BUDGET_MS",
        },
      ) + 15_000,
  };
}

export async function invokeWorker(
  config,
  { fetchImpl = fetch, signal } = {},
) {
  const timeout = AbortSignal.timeout(config.requestTimeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeout])
    : timeout;
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.secret}`,
    },
    signal: combinedSignal,
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error.slice(0, 200)
        : `Worker endpoint returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

export function waitForNextPoll(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function pollWorker(
  config,
  {
    fetchImpl = fetch,
    signal,
    onResult = (result) => console.log(JSON.stringify(result)),
    onError = (error) =>
      console.error(
        `[LeadHome jobs] ${error instanceof Error ? error.message : "Worker request failed."}`,
      ),
  },
) {
  while (!signal.aborted) {
    try {
      onResult(await invokeWorker(config, { fetchImpl, signal }));
    } catch (error) {
      if (!signal.aborted) onError(error);
    }
    await waitForNextPoll(config.pollIntervalMs, signal);
  }
}

async function loadNextEnvironment() {
  const nextEnvironment = await import("@next/env");
  const loadEnvConfig =
    nextEnvironment.loadEnvConfig ?? nextEnvironment.default?.loadEnvConfig;
  if (typeof loadEnvConfig !== "function") {
    throw new Error("Next.js environment loader is unavailable.");
  }
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
}

export async function main(argv = process.argv.slice(2)) {
  await loadNextEnvironment();
  const mode = argv[0] ?? "--once";
  if (!["--once", "--poll"].includes(mode)) {
    throw new Error("Usage: jobs-worker.mjs [--once|--poll]");
  }
  const config = readWorkerConfig();

  if (mode === "--once") {
    console.log(JSON.stringify(await invokeWorker(config)));
    return;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(
    `[LeadHome jobs] Polling ${config.endpoint} every ${config.pollIntervalMs}ms. Press Ctrl+C to stop.`,
  );
  await pollWorker(config, { signal: controller.signal });
  console.log("[LeadHome jobs] Worker stopped.");
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    console.error(
      `[LeadHome jobs] ${error instanceof Error ? error.message : "Worker failed."}`,
    );
    process.exitCode = 1;
  });
}
