"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-user";
import {
  attachConversationToLead,
  detachConversation,
} from "@/lib/messaging/conversation-service";
import {
  setConversationClassification,
  setConversationReviewState,
} from "@/lib/messaging/conversation-decision-service";
import { FakeProvider } from "@/lib/messaging/fake-provider";
import { importRecentMessages } from "@/lib/messaging/import-service";
import { reportOperationalError } from "@/lib/server-errors";

const idSchema = z.string().cuid();
const classificationSchema = z.enum([
  "UNKNOWN",
  "LEAD",
  "CUSTOMER",
  "NEWSLETTER",
  "SPAM",
  "INTERNAL",
  "SYSTEM",
]);
const reviewStateSchema = z.enum([
  "NEEDS_REVIEW",
  "MATCHED",
  "IGNORED",
  "RESOLVED",
]);

function assertDevelopment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development messaging actions are disabled.");
  }
}

export type ImportFakeMessagesState = {
  status?: "success" | "info" | "error";
  message?: string;
};

export async function importFakeMessagesAction(
  _state: ImportFakeMessagesState,
  _formData: FormData,
): Promise<ImportFakeMessagesState> {
  void _state;
  void _formData;
  assertDevelopment();
  const user = await requireUser();
  try {
    const summary = await importRecentMessages({
      ownerId: user.id,
      provider: new FakeProvider(),
    });
    revalidatePath("/dev/messages");
    if (
      summary.conversationsCreated === 0 &&
      summary.messagesCreated === 0
    ) {
      return {
        status: "info",
        message:
          "No new fixtures were imported. Existing fixtures are already up to date.",
      };
    }
    return {
      status: "success",
      message: `Import complete: ${summary.conversationsCreated} conversations and ${summary.messagesCreated} messages created.`,
    };
  } catch (error) {
    reportOperationalError("fake message import failed", error);
    return {
      status: "error",
      message: "The fake fixtures could not be imported. Please try again.",
    };
  }
}

export async function attachConversationAction(formData: FormData) {
  assertDevelopment();
  const user = await requireUser();
  const parsed = z.object({
    conversationId: idSchema,
    leadId: idSchema,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await attachConversationToLead({ ...parsed.data, ownerId: user.id });
  revalidatePath("/dev/messages");
  revalidatePath(`/leads/${parsed.data.leadId}`);
}

export async function detachConversationAction(formData: FormData) {
  assertDevelopment();
  const user = await requireUser();
  const parsed = idSchema.safeParse(formData.get("conversationId"));
  if (!parsed.success) return;
  await detachConversation({ conversationId: parsed.data, ownerId: user.id });
  revalidatePath("/dev/messages");
}

export async function classifyConversationAction(formData: FormData) {
  assertDevelopment();
  const user = await requireUser();
  const parsed = z.object({
    conversationId: idSchema,
    classification: classificationSchema,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await setConversationClassification({ ...parsed.data, ownerId: user.id });
  revalidatePath("/dev/messages");
}

export async function reviewConversationAction(formData: FormData) {
  assertDevelopment();
  const user = await requireUser();
  const parsed = z.object({
    conversationId: idSchema,
    reviewState: reviewStateSchema,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await setConversationReviewState({ ...parsed.data, ownerId: user.id });
  revalidatePath("/dev/messages");
}
