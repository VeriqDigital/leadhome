"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-user";
import {
  DuplicateLeadConfirmationRequired,
  createLeadFromConversation,
} from "@/lib/messaging/conversation-lead-service";
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
    nextFollowUpDate: formData.get("nextFollowUp"),
  };
}

export async function createLeadFromConversationAction(
  conversationId: string,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const [validConversation, parsed] = [
    leadIdSchema.safeParse(conversationId),
    leadSchema.safeParse(values(formData)),
  ];
  if (!validConversation.success || !parsed.success) {
    return {
      message: "Please correct the highlighted fields.",
      errors: parsed.success ? undefined : parsed.error.flatten().fieldErrors,
    };
  }
  const user = await requireUser();
  let leadId: string;
  try {
    const result = await createLeadFromConversation({
      ownerId: user.id,
      conversationId,
      lead: parsed.data,
      duplicateChoice:
        formData.get("duplicateChoice") === "attach-existing"
          ? "attach-existing"
          : formData.get("duplicateChoice") === "create-separate"
            ? "create-separate"
            : undefined,
      duplicateLeadId:
        typeof formData.get("duplicateLeadId") === "string"
          ? String(formData.get("duplicateLeadId"))
          : null,
    });
    leadId = result.leadId;
  } catch (error) {
    if (error instanceof DuplicateLeadConfirmationRequired) {
      return { message: "Choose how to handle the existing lead with this email." };
    }
    return { message: "The lead could not be created or attached." };
  }
  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath("/leads");
  revalidatePath("/leads/[id]", "page");
  revalidatePath("/pipeline");
  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}`);
}
