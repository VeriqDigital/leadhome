import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createLeadFromConversationAction } from "@/app/actions/conversation-lead-actions";
import { LeadForm } from "@/app/leads/lead-form";
import { requireUser } from "@/lib/auth-user";
import { getConversationLeadPrefill } from "@/lib/messaging/conversation-lead-service";

export default async function CreateLeadFromConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const user = await requireUser();
  const { conversationId } = await params;
  const prefill = await getConversationLeadPrefill(user.id, conversationId);
  if (!prefill || prefill.conversation.leadId) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/inbox?conversation=${conversationId}`} className="mb-5 inline-flex items-center gap-1 text-sm text-[#687080]">
        <ChevronLeft className="size-4" /> Back to conversation
      </Link>
      <section className="dashboard-card rounded-2xl border border-black/5.5 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">Create lead from conversation</h1>
        <p className="mb-8 mt-2 text-sm text-[#687080]">
          Review every field before creating and attaching this lead.
        </p>
        <LeadForm
          key={conversationId}
          action={createLeadFromConversationAction.bind(null, conversationId)}
          submitLabel="Create and attach lead"
          lead={prefill.lead}
          extraFields={
            prefill.duplicate ? (
              <fieldset className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                <legend className="px-1 font-semibold">Possible duplicate</legend>
                <p>
                  {prefill.duplicate.name} already uses {prefill.duplicate.email}.
                </p>
                <input type="hidden" name="duplicateLeadId" value={prefill.duplicate.id} />
                <label className="mt-3 flex cursor-pointer gap-2">
                  <input type="radio" name="duplicateChoice" value="attach-existing" required />
                  Attach this conversation to the existing lead
                </label>
                <label className="mt-2 flex cursor-pointer gap-2">
                  <input type="radio" name="duplicateChoice" value="create-separate" required />
                  Continue creating a separate lead
                </label>
                <Link href={`/inbox?conversation=${conversationId}`} className="mt-3 inline-block underline">
                  Cancel
                </Link>
              </fieldset>
            ) : null
          }
        />
      </section>
    </div>
  );
}
