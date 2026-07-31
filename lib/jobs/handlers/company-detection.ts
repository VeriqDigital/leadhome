import "server-only";

import type { Job } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  JobCancelledError,
  JobExecutionError,
  JobLeaseLostError,
} from "@/lib/jobs/errors";
import { heartbeatJob } from "@/lib/jobs/service";
import type { CompanyDetectionJobResult } from "@/lib/jobs/types";
import {
  companyDetectionJobPayloadSchema,
  companyDetectionJobResultSchema,
} from "@/lib/jobs/validation";
import {
  detectAndApplyConversationCompany,
} from "@/lib/messaging/company-detection-service";

async function checkpoint(jobId: string, workerId: string) {
  const lease = await heartbeatJob(jobId, workerId, {
    phase: "DETECTING",
    processed: 0,
    total: 1,
    percent: 10,
    message: "Checking company evidence.",
  });
  if (lease === "cancelled") throw new JobCancelledError();
  if (lease !== "ok") throw new JobLeaseLostError();
}

export async function runCompanyDetectionJob(
  job: Job,
  { workerId }: { workerId: string; deadlineAt?: number },
): Promise<CompanyDetectionJobResult> {
  const payload = companyDetectionJobPayloadSchema.safeParse(job.payload);
  if (!payload.success) {
    throw new JobExecutionError(
      "INVALID_JOB_PAYLOAD",
      "The company detection request was invalid.",
      false,
    );
  }

  await checkpoint(job.id, workerId);
  const startedAt = Date.now();
  const mutation = await detectAndApplyConversationCompany(
    job.ownerId,
    payload.data.conversationId,
  );
  const result = companyDetectionJobResultSchema.parse({
    conversationId: payload.data.conversationId,
    changed: mutation.changed,
    outcome: mutation.outcome,
    companyState: mutation.companyView.state,
    leadId: mutation.companyView.lead?.id ?? null,
    durationMs: Math.max(0, Date.now() - startedAt),
  });

  revalidatePath("/inbox");
  if (result.changed && result.leadId) {
    revalidatePath("/");
    revalidatePath("/leads");
    revalidatePath("/leads/[id]", "page");
    revalidatePath(`/leads/${result.leadId}`);
    revalidatePath("/pipeline");
  }
  return result;
}
