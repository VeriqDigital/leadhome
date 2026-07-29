import { randomUUID } from "node:crypto";
import { hasValidBearerSecret } from "@/lib/jobs/bearer-auth";
import { runJobInvocation } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export const CRON_MAX_JOBS = 10;
export const CRON_TIME_BUDGET_MS = 240_000;
const MINIMUM_CRON_SECRET_LENGTH = 43;

function configuredCronSecret(): string | null {
  const configured = process.env.CRON_SECRET;
  if (
    !configured ||
    configured !== configured.trim() ||
    configured.length < MINIMUM_CRON_SECRET_LENGTH
  ) {
    return null;
  }
  return configured;
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  const secret = configuredCronSecret();
  if (!hasValidBearerSecret(request, secret)) {
    return Response.json(
      { ok: false, error: "Unauthorized." },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }

  const startedAt = Date.now();
  console.info("[LeadHome] cron jobs", { event: "cron_jobs_started" });

  try {
    const stats = await runJobInvocation({
      workerId: randomUUID(),
      maxJobs: CRON_MAX_JOBS,
      timeBudgetMs: CRON_TIME_BUDGET_MS,
      signal: request.signal,
    });
    const summary = {
      ok: true,
      claimed: stats.claimed,
      completed: stats.completed,
      retried: stats.retried,
      failed: stats.failed,
      cancelled: stats.cancelled,
      leaseLost: stats.leaseLost,
      staleRecovered: stats.staleRecovered,
      purged: stats.purged,
      stoppedReason: stats.stoppedReason,
      durationMs: stats.durationMs,
    };
    console.info("[LeadHome] cron jobs", {
      event: "cron_jobs_finished",
      ...summary,
    });
    return json(summary);
  } catch {
    const durationMs = Math.max(0, Date.now() - startedAt);
    console.error("[LeadHome] cron jobs", {
      event: "cron_jobs_failed",
      durationMs,
    });
    return json({ ok: false, error: "Job invocation failed." }, 500);
  }
}
