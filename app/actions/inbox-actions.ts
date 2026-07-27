"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-user";
import {
  attachConversationControl,
  detachConversationControl,
  updateConversationClassification,
  updateConversationReviewState,
  updateConversationStatus,
  updateConversationControls,
  type CanonicalConversationControlsDto,
  type PersistedConversationMutation,
} from "@/lib/messaging/conversation-control-service";
import type { InboxMutationState } from "@/app/inbox/mutation-state";

const id = z.string().cuid();
const schemas = {
  attach: z.object({ conversationId: id, leadId: id }),
  conversation: z.object({ conversationId: id }),
  classification: z.object({
    conversationId: id,
    classification: z.enum(["UNKNOWN", "LEAD", "CUSTOMER", "NEWSLETTER", "SPAM", "INTERNAL", "SYSTEM"]),
  }),
  review: z.object({
    conversationId: id,
    reviewState: z.enum(["NEEDS_REVIEW", "MATCHED", "IGNORED", "RESOLVED"]),
  }),
  status: z.object({
    conversationId: id,
    status: z.enum(["OPEN", "CLOSED", "ARCHIVED"]),
  }),
  allControls: z.object({
    conversationId: id,
    leadId: z.union([id, z.literal("")]).transform((value) => value || null),
    classification: z.enum(["UNKNOWN", "LEAD", "CUSTOMER", "NEWSLETTER", "SPAM", "INTERNAL", "SYSTEM"]),
    reviewState: z.enum(["NEEDS_REVIEW", "MATCHED", "IGNORED", "RESOLVED"]),
    status: z.enum(["OPEN", "CLOSED", "ARCHIVED"]),
  }),
};

function validationFailure(error: z.ZodError): InboxMutationState {
  return {
    success: false,
    message: "Choose a valid value before saving.",
    errors: error.flatten().fieldErrors,
  };
}

async function persisted(
  operation: () => Promise<PersistedConversationMutation>,
  changedMessage: (conversation: CanonicalConversationControlsDto) => string,
): Promise<InboxMutationState> {
  try {
    const result = await operation();
    if (result.changed) {
      revalidatePath("/inbox");
      revalidatePath("/leads");
    }
    return {
      success: true,
      changed: result.changed,
      message: result.changed ? changedMessage(result.conversation) : "No changes to save.",
      conversation: result.conversation,
    };
  } catch {
    return { success: false, message: "That change was not saved. The conversation may be unavailable." };
  }
}

export async function attachInboxAction(_state: InboxMutationState, formData: FormData) {
  const parsed = schemas.attach.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const user = await requireUser();
  return persisted(
    () => attachConversationControl({ ownerId: user.id, ...parsed.data }),
    (conversation) => `Conversation attached to ${conversation.lead?.name ?? "the selected lead"}.`,
  );
}

export async function detachInboxAction(_state: InboxMutationState, formData: FormData) {
  const parsed = schemas.conversation.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const user = await requireUser();
  return persisted(
    () => detachConversationControl({ ownerId: user.id, ...parsed.data }),
    () => "Conversation detached.",
  );
}

export async function classifyInboxAction(_state: InboxMutationState, formData: FormData) {
  const parsed = schemas.classification.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const user = await requireUser();
  return persisted(
    () => updateConversationClassification({ ownerId: user.id, ...parsed.data }),
    () => "Classification updated.",
  );
}

export async function reviewInboxAction(_state: InboxMutationState, formData: FormData) {
  const parsed = schemas.review.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const user = await requireUser();
  return persisted(
    () => updateConversationReviewState({ ownerId: user.id, ...parsed.data }),
    () => "Review state updated.",
  );
}

export async function statusInboxAction(_state: InboxMutationState, formData: FormData) {
  const parsed = schemas.status.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const user = await requireUser();
  return persisted(
    () => updateConversationStatus({ ownerId: user.id, ...parsed.data }),
    () => "Conversation status updated.",
  );
}

export async function saveInboxControlsAction(_state: InboxMutationState, formData: FormData) {
  const parsed = schemas.allControls.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const user = await requireUser();
  return persisted(
    () => updateConversationControls({ ownerId: user.id, ...parsed.data }),
    () => "Conversation changes saved.",
  );
}
