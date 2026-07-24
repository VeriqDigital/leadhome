import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-user";
import { getLeadActivitiesForUser } from "@/lib/lead-activities";
import { deleteLeadAction, updateLeadAction } from "../../actions/lead-actions";
import { ActivityTimeline } from "../activity-timeline";
import { DeleteLeadButton } from "../delete-lead-button";
import { LeadForm } from "../lead-form";
export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const lead = await prisma.lead.findFirst({ where: { id, userId: user.id } });
  if (!lead) notFound();
  const activities = await getLeadActivitiesForUser({
    leadId: lead.id,
    userId: user.id,
  });
  const update = updateLeadAction.bind(null, lead.id);
  const remove = deleteLeadAction.bind(null, lead.id);
  return (
    <div className="mx-auto max-w-315">
      <Link
        href="/leads"
        className="mb-5 inline-flex items-center gap-1 text-sm text-[#687080] hover:text-black"
      >
        <ChevronLeft className="size-4" />
        Back to leads
      </Link>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.9fr)]">
        <section className="dashboard-card rounded-2xl border border-black/5.5 bg-white p-6 shadow-[0_8px_30px_rgba(23,24,28,0.035)] sm:p-8">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {lead.name}
              </h1>
              <p className="mt-2 text-sm text-[#687080]">
                Created {lead.createdAt.toLocaleDateString()}
              </p>
            </div>
            <DeleteLeadButton action={remove} />
          </div>
          <LeadForm
            action={update}
            submitLabel="Save changes"
            lead={{
              ...lead,
              estimatedValue: lead.estimatedValue?.toString() ?? null,
              nextFollowUpDate:
                lead.nextFollowUpDate?.toISOString().slice(0, 10) ?? null,
            }}
          />
        </section>
        <ActivityTimeline activities={activities} />
      </div>
    </div>
  );
}
