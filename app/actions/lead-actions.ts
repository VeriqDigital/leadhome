"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { buildLeadUpdateActivities } from "@/lib/lead-activities";
import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  leadIdSchema,
  leadSchema,
  type ActionState,
} from "@/lib/validation";
import type { CanonicalLead } from "@/lib/lead-types";
import { reportOperationalError } from "@/lib/server-errors";
import { changeLeadStatusInTransaction } from "@/lib/pipeline/status-service";
import { recordActivities, recordActivity } from "@/lib/activity-service";
import { formatDateInputValue } from "@/lib/lead-format";

function values(formData: FormData) {
  const message = formData.get("message");
  return {
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    company: formData.get("company"),
    source: formData.get("source"),
    status: formData.get("status"),
    message:
      typeof message === "string" ? message.replace(/\r\n?/g, "\n") : message,
    estimatedValue: formData.get("estimatedValue"),
    nextFollowUpDate: formData.get("nextFollowUp"),
  };
}

function canonicalLead(lead: {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: CanonicalLead["source"];
  status: CanonicalLead["status"];
  estimatedValue: { toString(): string } | number | null;
  nextFollowUpDate: Date | null;
  message: string | null;
  updatedAt: Date;
}): CanonicalLead {
  return {
    id: lead.id,
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    status: lead.status,
    estimatedValue: lead.estimatedValue?.toString() ?? null,
    nextFollowUp: formatDateInputValue(lead.nextFollowUpDate),
    message: lead.message,
    updatedAt: lead.updatedAt.toISOString(),
  };
}

function revalidateLead(id?: string) {
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/inbox");
  if (id) revalidatePath(`/leads/${id}`);
}

export async function createLeadAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = leadSchema.safeParse(values(formData));
  if (!parsed.success) {
    return {
      errors: parsed.error.flatten().fieldErrors,
      message: "Please correct the highlighted fields.",
    };
  }

  let id: string;
  try {
    id = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: { ...parsed.data, userId: user.id },
        select: { id: true },
      });
      await recordActivity(tx, {
        ownerId: user.id,
        leadId: lead.id,
        type: "LEAD_CREATED",
        actorType: "USER",
        source: "MANUAL",
        title: "Lead created",
        description: "Created manually",
      });
      return lead.id;
    });
  } catch (error) {
    reportOperationalError("create lead failed", error);
    return { message: "We couldn't save this lead. Please try again." };
  }

  revalidateLead();
  redirect(`/leads/${id}`);
}

export async function updateLeadAction(
  id: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const validId = leadIdSchema.safeParse(id);
  const parsed = leadSchema.safeParse(values(formData));
  if (!validId.success || !parsed.success) {
    return {
      errors: parsed.success ? undefined : parsed.error.flatten().fieldErrors,
      message: "Please correct the highlighted fields.",
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.lead.findFirst({
        where: { id, userId: user.id },
      });
      if (!previous) return { kind: "not-found" as const };

      const canonicalInput = {
        ...parsed.data,
        // Open follow-up tasks are the source of truth. Never let a stale or
        // tampered read-only form field overwrite their derived summary.
        nextFollowUpDate: previous.nextFollowUpDate,
      };
      const activities = buildLeadUpdateActivities(
        previous,
        canonicalInput,
      ).filter((activity) => activity.type !== "STATUS_CHANGED");
      const statusChanged = previous.status !== parsed.data.status;
      if (!activities.length && !statusChanged) {
        return {
          kind: "unchanged" as const,
          lead: canonicalLead(previous),
        };
      }

      if (statusChanged) {
        const statusResult = await changeLeadStatusInTransaction(tx, {
          ownerId: user.id,
          leadId: id,
          status: parsed.data.status,
          current: { id, status: previous.status },
        });
        if (statusResult.kind !== "changed") {
          throw new Error("Lead status was not updated.");
        }
      }
      const nonStatusData = {
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        company: parsed.data.company,
        source: parsed.data.source,
        message: parsed.data.message,
        estimatedValue: parsed.data.estimatedValue,
      };
      const updated = activities.length
        ? await tx.lead.update({ where: { id }, data: nonStatusData })
        : await tx.lead.findFirst({ where: { id, userId: user.id } });
      if (!updated) return { kind: "not-found" as const };
      if (activities.length) {
        await recordActivities(
          tx,
          activities.map((activity) => ({
            ...activity,
            leadId: id,
            ownerId: user.id,
            actorType: "USER" as const,
            source: "MANUAL" as const,
          })),
        );
      }
      return {
        kind: "changed" as const,
        lead: canonicalLead(updated),
      };
    });
    if (result.kind === "not-found") return { message: "Lead not found." };
    if (result.kind === "unchanged") {
      revalidateLead(id);
      return {
        success: true,
        changed: false,
        message: "No changes to save.",
        lead: result.lead,
      };
    }
    revalidateLead(id);
    return {
      success: true,
      changed: true,
      message: "Lead updated.",
      lead: result.lead,
    };
  } catch (error) {
    reportOperationalError("update lead failed", error);
    return { message: "We couldn't update this lead. Please try again." };
  }
}

export async function deleteLeadAction(id: string) {
  const user = await requireUser();
  const parsed = leadIdSchema.safeParse(id);
  if (!parsed.success) return;
  await prisma.$transaction(async (tx) => {
    // Lead deletion uses SET NULL for the relation. Reset the owned
    // conversation's review metadata first so it cannot be left claiming to
    // be MATCHED after its attached lead disappears.
    await tx.conversation.updateMany({
      where: {
        ownerId: user.id,
        leadId: id,
        lead: { userId: user.id },
      },
      data: {
        leadId: null,
        reviewState: "NEEDS_REVIEW",
        manuallyDetached: false,
        matchKind: "NO_MATCH",
        matchReason: "attached lead was deleted",
        matchCandidateLeadIds: Prisma.JsonNull,
      },
    });
    await tx.lead.deleteMany({ where: { id, userId: user.id } });
  });
  revalidateLead();
  redirect("/leads");
}
