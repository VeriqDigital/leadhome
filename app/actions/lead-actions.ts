"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildLeadUpdateActivities } from "@/lib/lead-activities";
import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  leadIdSchema,
  leadSchema,
  type ActionState,
  type CanonicalLead,
} from "@/lib/validation";

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
    nextFollowUp: lead.nextFollowUpDate?.toISOString().slice(0, 10) ?? null,
    message: lead.message,
    updatedAt: lead.updatedAt.toISOString(),
  };
}

function revalidateLead(id?: string) {
  revalidatePath("/");
  revalidatePath("/leads");
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
      await tx.leadActivity.create({
        data: {
          leadId: lead.id,
          userId: user.id,
          type: "LEAD_CREATED",
          title: "Lead created",
          description: "Created manually",
        },
      });
      return lead.id;
    });
  } catch {
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

      const activities = buildLeadUpdateActivities(previous, parsed.data);
      if (!activities.length) {
        return {
          kind: "unchanged" as const,
          lead: canonicalLead(previous),
        };
      }

      const updated = await tx.lead.update({ where: { id }, data: parsed.data });
      await tx.leadActivity.createMany({
        data: activities.map((activity) => ({
          ...activity,
          leadId: id,
          userId: user.id,
        })),
      });
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
  } catch {
    return { message: "We couldn't update this lead. Please try again." };
  }
}

export async function changeLeadStatusAction(id: string, formData: FormData) {
  const user = await requireUser();
  const parsedId = leadIdSchema.safeParse(id);
  const parsed = leadSchema
    .pick({ status: true })
    .safeParse({ status: formData.get("status") });
  if (!parsedId.success || !parsed.success) return;

  await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id, userId: user.id } });
    if (!lead || lead.status === parsed.data.status) return;
    const [activity] = buildLeadUpdateActivities(lead, {
      ...lead,
      status: parsed.data.status,
    });
    await tx.lead.update({ where: { id }, data: { status: parsed.data.status } });
    await tx.leadActivity.create({
      data: { ...activity, leadId: id, userId: user.id },
    });
  });
  revalidateLead(id);
}

export async function deleteLeadAction(id: string) {
  const user = await requireUser();
  const parsed = leadIdSchema.safeParse(id);
  if (!parsed.success) return;
  await prisma.lead.deleteMany({ where: { id, userId: user.id } });
  revalidateLead();
  redirect("/leads");
}
