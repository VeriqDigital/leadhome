"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth-user";
import {
  attachConversationToLead,
  detachConversation,
} from "@/lib/messaging/conversation-service";
import { FakeProvider } from "@/lib/messaging/fake-provider";
import { importRecentMessages } from "@/lib/messaging/import-service";

const idSchema = z.string().cuid();

export async function importFakeMessagesAction() {
  const user = await requireUser();
  await importRecentMessages({
    ownerId: user.id,
    provider: new FakeProvider(),
    displayName: "Development inbox",
    address: "inbox@leadhome.test",
    providerAccountId: "lead-home-development-fixtures",
  });
  revalidatePath("/dev/messages");
}

export async function attachConversationAction(formData: FormData) {
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
  const user = await requireUser();
  const parsed = idSchema.safeParse(formData.get("conversationId"));
  if (!parsed.success) return;
  await detachConversation({ conversationId: parsed.data, ownerId: user.id });
  revalidatePath("/dev/messages");
}
