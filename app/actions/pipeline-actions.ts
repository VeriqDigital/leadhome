"use server";

import { revalidatePath } from "next/cache";
import { LeadStatus } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/auth-user";
import { moveLeadStatus } from "@/lib/pipeline/status-service";

const moveSchema = z.object({
  leadId: z.cuid(),
  status: z.enum(LeadStatus),
});

export type PipelineMoveResult =
  | {
      success: true;
      changed: boolean;
      lead: { id: string; name: string; status: LeadStatus; updatedAt: string };
    }
  | { success: false; message: string };

export async function movePipelineLeadAction(input: {
  leadId: string;
  status: string;
}): Promise<PipelineMoveResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Choose a valid pipeline stage." };
  }
  const user = await requireUser();
  try {
    const result = await moveLeadStatus(
      user.id,
      parsed.data.leadId,
      parsed.data.status,
    );
    if (result.kind === "not-found") {
      return { success: false, message: "Lead not found." };
    }
    revalidatePath("/");
    revalidatePath("/pipeline");
    revalidatePath("/leads");
    revalidatePath(`/leads/${result.lead.id}`);
    return {
      success: true,
      changed: result.kind === "changed",
      lead: {
        ...result.lead,
        updatedAt: result.lead.updatedAt.toISOString(),
      },
    };
  } catch {
    return { success: false, message: "The stage change could not be saved." };
  }
}
