"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildLeadUpdateActivities } from "@/lib/lead-activities";
import { requireUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { leadIdSchema, leadSchema, type ActionState } from "@/lib/validation";

function values(formData: FormData) {
  return {
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    company: formData.get("company"),
    source: formData.get("source"),
    status: formData.get("status"),
    message: formData.get("message"),
    estimatedValue: formData.get("estimatedValue"),
    nextFollowUpDate: formData.get("nextFollowUpDate"),
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
    const found = await prisma.$transaction(async (tx) => {
      const previous = await tx.lead.findFirst({
        where: { id, userId: user.id },
      });
      if (!previous) return false;

      const activities = buildLeadUpdateActivities(previous, parsed.data);
      await tx.lead.update({ where: { id }, data: parsed.data });
      if (activities.length) {
        await tx.leadActivity.createMany({
          data: activities.map((activity) => ({
            ...activity,
            leadId: id,
            userId: user.id,
          })),
        });
      }
      return true;
    });
    if (!found) return { message: "Lead not found." };
  } catch {
    return { message: "We couldn't update this lead. Please try again." };
  }

  revalidateLead(id);
  return { success: true, message: "Lead updated." };
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
