import { randomUUID } from "node:crypto";
import { hasValidBearerSecret } from "@/lib/jobs/bearer-auth";
import { getJobConfig } from "@/lib/jobs/config";
import { runJobInvocation } from "@/lib/jobs/runner";
import { reportOperationalError } from "@/lib/server-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export function hasValidWorkerSecret(
  request: Request,
  expectedSecret: string | null,
) {
  return hasValidBearerSecret(request, expectedSecret);
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const config = getJobConfig();
  if (!config.runnerSecret) {
    return json({ ok: false, error: "Job runner is not configured." }, 503);
  }
  if (!hasValidWorkerSecret(request, config.runnerSecret)) {
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

  try {
    const stats = await runJobInvocation({
      workerId: randomUUID(),
      maxJobs: config.jobsPerRun,
      timeBudgetMs: config.runTimeBudgetMs,
      signal: request.signal,
    });
    return json({
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
      stoppedForTimeBudget: stats.stoppedForTimeBudget,
      durationMs: stats.durationMs,
    });
  } catch (error) {
    reportOperationalError("job worker invocation failed", error);
    return json({ ok: false, error: "Worker invocation failed." }, 500);
  }
}
