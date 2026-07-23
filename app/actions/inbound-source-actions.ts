"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-user";
import {
  createInboundSource,
  deleteInboundSource,
  rotateInboundSource,
  setInboundSourceActive,
} from "@/lib/inbound-sources";
import { inboundSourceIdSchema, inboundSourceNameSchema } from "@/lib/inbound-validation";

export type SourceActionState = {
  success?: boolean;
  message?: string;
  token?: string;
  sourceName?: string;
};

export async function createInboundSourceAction(
  _state: SourceActionState,
  formData: FormData,
): Promise<SourceActionState> {
  const user = await requireUser();
  const name = inboundSourceNameSchema.safeParse(formData.get("name"));
  if (!name.success) return { message: "Enter a source name between 2 and 100 characters." };
  try {
    const source = await createInboundSource(user.id, name.data);
    revalidatePath("/settings");
    return { success: true, message: "Source created. Copy this token now; it will not be shown again.", token: source.token, sourceName: source.name };
  } catch {
    return { message: "We couldn't create this source. Please try again." };
  }
}

export async function rotateInboundSourceAction(
  _state: SourceActionState,
  formData: FormData,
): Promise<SourceActionState> {
  const user = await requireUser();
  const sourceId = inboundSourceIdSchema.safeParse(formData.get("sourceId"));
  if (!sourceId.success) return { message: "Source not found." };
  try {
    const token = await rotateInboundSource(user.id, sourceId.data);
    if (!token) return { message: "Source not found." };
    revalidatePath("/settings");
    return { success: true, message: "Token rotated. The previous token is now invalid.", token };
  } catch {
    return { message: "We couldn't rotate this token. Please try again." };
  }
}

export async function setInboundSourceActiveAction(formData: FormData) {
  const user = await requireUser();
  const sourceId = inboundSourceIdSchema.safeParse(formData.get("sourceId"));
  const active = formData.get("isActive") === "true";
  if (!sourceId.success) return;
  await setInboundSourceActive(user.id, sourceId.data, active);
  revalidatePath("/settings");
}

export async function deleteInboundSourceAction(formData: FormData) {
  const user = await requireUser();
  const sourceId = inboundSourceIdSchema.safeParse(formData.get("sourceId"));
  if (!sourceId.success) return;
  await deleteInboundSource(user.id, sourceId.data);
  revalidatePath("/settings");
}
