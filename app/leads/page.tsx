import Link from "next/link";
import { LeadStatus } from "@prisma/client";
import { Plus, Search, UsersRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-user";
import { formatCurrency, sourceLabels, statusLabels } from "@/lib/lead-format";
import { PageHeader } from "../page-header";
import { StatusBadge } from "../components";

const statuses = Object.values(LeadStatus);
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const status = statuses.includes(params.status as LeadStatus)
    ? (params.status as LeadStatus)
    : undefined;
  const leads = await prisma.lead.findMany({
    where: {
      userId: user.id,
      status,
      ...(params.q
        ? {
            OR: [
              { name: { contains: params.q, mode: "insensitive" } },
              { email: { contains: params.q, mode: "insensitive" } },
              { company: { contains: params.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="mx-auto max-w-315">
      <PageHeader
        title="Leads"
        description="Review and organize every incoming opportunity."
        action={
          <Link
            href="/leads/new"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#17181c] px-4 text-sm font-semibold text-white"
          >
            <Plus className="size-4" />
            New Lead
          </Link>
        }
      />
      <section className="dashboard-card mt-9 rounded-2xl border border-black/5.5 bg-white p-6 shadow-[0_8px_30px_rgba(23,24,28,0.035)]">
        <form className="mb-6 flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3.5 top-3 size-4 text-[#687080]" />
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Search name, email, or company"
              className="h-10 w-full rounded-xl border border-black/9 bg-transparent pl-10 pr-3 text-sm"
            />
          </label>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-10 rounded-xl border border-black/9 bg-transparent px-3 text-sm"
          >
            <option value="">All statuses</option>
            {statuses.map((item) => (
              <option key={item} value={item}>
                {statusLabels[item]}
              </option>
            ))}
          </select>
          <button className="h-10 rounded-xl border border-black/9 px-4 text-sm font-semibold">
            Apply filters
          </button>
        </form>
        {leads.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-175 text-left">
              <thead>
                <tr className="border-b border-black/[0.07] text-xs text-[#687080]">
                  <th className="pb-3 font-medium">Lead</th>
                  <th className="pb-3 font-medium">Source</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Value</th>
                  <th className="pb-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-black/5.5 last:border-0"
                  >
                    <td className="py-4">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-sm font-semibold hover:underline"
                      >
                        {lead.name}
                      </Link>
                      <p className="mt-1 text-xs text-[#687080]">
                        {lead.company || lead.email || "No company or email"}
                      </p>
                    </td>
                    <td className="py-4 text-sm text-[#687080]">
                      {sourceLabels[lead.source]}
                    </td>
                    <td className="py-4">
                      <StatusBadge status={statusLabels[lead.status]} />
                    </td>
                    <td className="py-4 text-sm">
                      {lead.estimatedValue
                        ? formatCurrency(lead.estimatedValue.toString())
                        : "—"}
                    </td>
                    <td className="py-4 text-sm text-[#687080]">
                      {lead.createdAt.toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid min-h-72 place-items-center text-center">
            <div>
              <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[#f1f2f4] text-[#687080]">
                <UsersRound className="size-5" />
              </span>
              <h2 className="mt-4 font-semibold">No leads found</h2>
              <p className="mt-1 text-sm text-[#687080]">
                Create your first lead or adjust your filters.
              </p>
              <Link
                href="/leads/new"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#17181c] px-4 py-2.5 text-sm font-semibold text-white"
              >
                <Plus className="size-4" />
                Create lead
              </Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
