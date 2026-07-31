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
import {
  allowConversationMatchingAgain,
  dismissConversationLeadMatch,
  reevaluateConversationLeadMatch,
  type PersistedConversationMatchState,
} from "@/lib/messaging/matching-service";
import type {
  CompanyDetectionMutationState,
  InboxMutationState,
} from "@/app/inbox/mutation-state";
import {
  applyConversationCompanySuggestion,
  dismissConversationCompanySuggestion,
  recheckConversationCompany,
} from "@/lib/messaging/company-detection-service";

const id = z.string().cuid();
export type SmartMatchMutationState = {
  success: boolean;
  changed?: boolean;
  message: string;
  conversation?: PersistedConversationMatchState;
};
const schemas = {
  attach: z.object({ conversationId: id, leadId: id }),
  dismissMatch: z.object({ conversationId: id, leadId: id }),
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
  companyMutation: z.discriminatedUnion("intent", [
    z.object({
      intent: z.literal("APPLY"),
      conversationId: id,
      expectedLeadId: id,
      evidenceFingerprint: z
        .string()
        .regex(/^[a-f0-9]{64}$/),
    }),
    z.object({
      intent: z.literal("DISMISS"),
      conversationId: id,
      expectedLeadId: id,
      evidenceFingerprint: z
        .string()
        .regex(/^[a-f0-9]{64}$/),
    }),
    z.object({
      intent: z.literal("RECHECK"),
      conversationId: id,
      expectedLeadId: z.string().optional(),
      evidenceFingerprint: z.string().optional(),
    }),
  ]),
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
      revalidatePath("/");
      revalidatePath("/inbox");
      revalidatePath("/leads");
      revalidatePath("/leads/[id]", "page");
      revalidatePath("/pipeline");
      if (result.conversation.leadId) {
        revalidatePath(`/leads/${result.conversation.leadId}`);
      }
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

export async function recheckConversationMatchesAction(
  _state: SmartMatchMutationState,
  formData: FormData,
): Promise<SmartMatchMutationState> {
  const parsed = schemas.conversation.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { success: false, message: "Choose a valid conversation." };
  }
  const user = await requireUser();
  try {
    const result = await reevaluateConversationLeadMatch(
      user.id,
      parsed.data.conversationId,
    );
    revalidatePath("/inbox");
    if (result.conversation.manuallyDetached) {
      return {
        success: false,
        changed: false,
        message: "Automatic matching is still paused.",
        conversation: result.conversation,
      };
    }
    if (result.conversation.leadId) {
      revalidatePath("/");
      revalidatePath("/leads");
      revalidatePath("/pipeline");
      revalidatePath(`/leads/${result.conversation.leadId}`);
      return {
        success: true,
        changed: result.changed,
        message: result.attached
          ? "The exact match was attached."
          : "Conversation is already attached.",
        conversation: result.conversation,
      };
    }
    if (result.conversation.matchKind === "AMBIGUOUS") {
      const count = result.conversation.matchCandidateLeadIds.length;
      return {
        success: true,
        changed: result.changed,
        message: `${count} possible match${count === 1 ? "" : "es"} found.`,
        conversation: result.conversation,
      };
    }
    return {
      success: true,
      changed: result.changed,
      message: "No credible match was found.",
      conversation: result.conversation,
    };
  } catch {
    return {
      success: false,
      message: "Matches could not be checked. Please try again.",
    };
  }
}

export async function dismissConversationMatchAction(
  _state: SmartMatchMutationState,
  formData: FormData,
): Promise<SmartMatchMutationState> {
  const parsed = schemas.dismissMatch.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { success: false, message: "Choose a valid match suggestion." };
  }
  const user = await requireUser();
  try {
    const result = await dismissConversationLeadMatch({
      ownerId: user.id,
      ...parsed.data,
    });
    revalidatePath("/inbox");
    return {
      success: true,
      changed: result.changed,
      message: result.conversation.matchKind === "AMBIGUOUS"
        ? "Suggestion dismissed. Other possible matches remain."
        : "Suggestion dismissed.",
      conversation: result.conversation,
    };
  } catch {
    return {
      success: false,
      message: "That suggestion could not be dismissed.",
    };
  }
}

export async function allowConversationMatchingAgainAction(
  _state: SmartMatchMutationState,
  formData: FormData,
): Promise<SmartMatchMutationState> {
  const parsed = schemas.conversation.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { success: false, message: "Choose a valid conversation." };
  }
  const user = await requireUser();
  try {
    const result = await allowConversationMatchingAgain(
      user.id,
      parsed.data.conversationId,
    );
    revalidatePath("/inbox");
    if (result.conversation.leadId) {
      revalidatePath("/");
      revalidatePath("/leads");
      revalidatePath("/pipeline");
      revalidatePath(`/leads/${result.conversation.leadId}`);
      return {
        success: true,
        changed: result.suppressionCleared || result.changed,
        message: result.attached
          ? "Automatic matching resumed and the exact match was attached."
          : "Conversation is already attached.",
        conversation: result.conversation,
      };
    }
    if (result.conversation.manuallyDetached) {
      return {
        success: false,
        changed: false,
        message: "Automatic matching could not be resumed. Please try again.",
        conversation: result.conversation,
      };
    }
    if (result.conversation.matchKind === "AMBIGUOUS") {
      const count = result.conversation.matchCandidateLeadIds.length;
      return {
        success: true,
        changed: result.suppressionCleared || result.changed,
        message: `Automatic matching resumed. ${count} possible match${
          count === 1 ? "" : "es"
        } found.`,
        conversation: result.conversation,
      };
    }
    return {
      success: true,
      changed: result.suppressionCleared || result.changed,
      message: "Automatic matching resumed. No credible match was found.",
      conversation: result.conversation,
    };
  } catch {
    return {
      success: false,
      message: "Automatic matching could not be resumed. Please try again.",
    };
  }
}

export async function mutateConversationCompanyAction(
  _state: CompanyDetectionMutationState,
  formData: FormData,
): Promise<CompanyDetectionMutationState> {
  const parsed = schemas.companyMutation.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success) {
    return {
      success: false,
      message: "That company suggestion is no longer available.",
    };
  }
  const user = await requireUser();
  try {
    const result = parsed.data.intent === "APPLY"
      ? await applyConversationCompanySuggestion({
          ownerId: user.id,
          conversationId: parsed.data.conversationId,
          expectedLeadId: parsed.data.expectedLeadId,
          evidenceFingerprint: parsed.data.evidenceFingerprint,
        })
      : parsed.data.intent === "DISMISS"
        ? await dismissConversationCompanySuggestion({
            ownerId: user.id,
            conversationId: parsed.data.conversationId,
            expectedLeadId: parsed.data.expectedLeadId,
            evidenceFingerprint: parsed.data.evidenceFingerprint,
          })
        : await recheckConversationCompany(
            user.id,
            parsed.data.conversationId,
          );

    revalidatePath("/inbox");
    if (result.changed && result.outcome === "APPLIED") {
      revalidatePath("/");
      revalidatePath("/leads");
      revalidatePath("/pipeline");
      if (result.companyView.lead) {
        revalidatePath(`/leads/${result.companyView.lead.id}`);
      }
    }
    if (
      result.outcome === "STALE" ||
      result.outcome === "NOT_APPLICABLE"
    ) {
      return {
        success: false,
        changed: false,
        message:
          "The lead or company changed before this request was completed.",
        companyView: result.companyView,
      };
    }
    const message = result.outcome === "APPLIED"
      ? parsed.data.intent === "RECHECK"
        ? "Company detected and applied."
        : "Company applied."
      : result.outcome === "DISMISSED"
        ? result.changed
          ? "Company suggestion dismissed."
          : "This suggestion was already dismissed."
        : result.companyView.state === "SUGGESTED"
          ? "Company evidence checked. A suggestion is ready for review."
          : "Company evidence checked. No credible suggestion was found.";
    return {
      success: true,
      changed: result.changed,
      message,
      companyView: result.companyView,
    };
  } catch {
    return {
      success: false,
      message: "Company detection could not be updated. Please try again.",
    };
  }
}
