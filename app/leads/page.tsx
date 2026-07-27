import Link from "next/link";
import { Plus, Search, UsersRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-user";
import {
  formatCurrency,
  formatDate,
  sourceLabels,
  statusLabels,
  statusValues,
} from "@/lib/lead-format";
import {
  buildLeadsQuery,
  LEADS_PAGE_SIZE,
  leadSortOptions,
  type LeadsSearchParams,
} from "@/lib/leads-query";
import { PageHeader } from "../page-header";
import { StatusBadge } from "../components";
import { StatusFilter } from "./status-filter";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<LeadsSearchParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const { args, status, sort, page } = buildLeadsQuery(user.id, params);
  const rows = await prisma.lead.findMany(args);
  const hasNext = rows.length > LEADS_PAGE_SIZE;
  const leads = rows.slice(0, LEADS_PAGE_SIZE);
  const pageHref = (nextPage: number) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (status) query.set("status", status);
    if (sort !== "updated-desc") query.set("sort", sort);
    if (nextPage > 1) query.set("page", String(nextPage));
    return `/leads${query.size ? `?${query}` : ""}`;
  };
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
          <StatusFilter
            defaultValue={status ?? ""}
            options={[
              { value: "", label: "All statuses" },
              ...statusValues.map((item) => ({
                value: item,
                label: statusLabels[item],
              })),
            ]}
          />
          <StatusFilter
            name="sort"
            defaultValue={sort}
            options={[...leadSortOptions]}
          />
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
                  <th className="pb-3 font-medium">Last Updated</th>
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
                      {formatDate(lead.createdAt)}
                    </td>
                    <td className="py-4 text-sm text-[#687080]">
                      {formatDate(lead.updatedAt)}
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
        {(page > 1 || hasNext) && (
          <nav
            aria-label="Leads pagination"
            className="mt-6 flex items-center justify-between text-sm"
          >
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="rounded-lg border border-black/10 px-3 py-2"
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-[#687080]">Page {page}</span>
            {hasNext ? (
              <Link
                href={pageHref(page + 1)}
                className="rounded-lg border border-black/10 px-3 py-2"
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
