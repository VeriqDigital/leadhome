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
  setConversationStatus,
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
const statusSchema = z.enum(["OPEN", "CLOSED", "ARCHIVED"]);

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
    revalidatePath("/");
    revalidatePath("/dev/messages");
    revalidatePath("/inbox");
    revalidatePath("/leads");
    revalidatePath("/leads/[id]", "page");
    revalidatePath("/pipeline");
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
  const user = await requireUser();
  const parsed = z.object({
    conversationId: idSchema,
    leadId: idSchema,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid conversation attachment.");
  await attachConversationToLead({ ...parsed.data, ownerId: user.id });
  revalidatePath("/");
  revalidatePath("/dev/messages");
  revalidatePath("/inbox");
  revalidatePath("/leads");
  revalidatePath("/leads/[id]", "page");
  revalidatePath("/pipeline");
  revalidatePath(`/leads/${parsed.data.leadId}`);
}

export async function detachConversationAction(formData: FormData) {
  const user = await requireUser();
  const parsed = idSchema.safeParse(formData.get("conversationId"));
  if (!parsed.success) throw new Error("Invalid conversation.");
  await detachConversation({ conversationId: parsed.data, ownerId: user.id });
  revalidatePath("/");
  revalidatePath("/dev/messages");
  revalidatePath("/inbox");
  revalidatePath("/leads");
  revalidatePath("/leads/[id]", "page");
  revalidatePath("/pipeline");
}

export async function classifyConversationAction(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({
    conversationId: idSchema,
    classification: classificationSchema,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid classification.");
  await setConversationClassification({ ...parsed.data, ownerId: user.id });
  revalidatePath("/dev/messages");
  revalidatePath("/inbox");
}

export async function reviewConversationAction(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({
    conversationId: idSchema,
    reviewState: reviewStateSchema,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid review state.");
  await setConversationReviewState({ ...parsed.data, ownerId: user.id });
  revalidatePath("/dev/messages");
  revalidatePath("/inbox");
}

export async function statusConversationAction(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({
    conversationId: idSchema,
    status: statusSchema,
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid conversation status.");
  await setConversationStatus({ ...parsed.data, ownerId: user.id });
  revalidatePath("/inbox");
  revalidatePath("/dev/messages");
}
