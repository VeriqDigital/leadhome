import type { Prisma } from "@prisma/client";
import { isLeadStatus } from "@/lib/lead-format";
import {
  parseLeadAttention,
  untouchedLeadWhere,
  type LeadAttentionFilter,
} from "@/lib/dashboard/attention";

export const LEADS_PAGE_SIZE = 25;

export const leadSortOptions = [
  { value: "updated-desc", label: "Recently updated" },
  { value: "updated-asc", label: "Oldest updated" },
  { value: "created-desc", label: "Newest created" },
  { value: "created-asc", label: "Oldest created" },
  { value: "value-desc", label: "Highest value" },
  { value: "value-asc", label: "Lowest value" },
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
] as const;

export type LeadSort = (typeof leadSortOptions)[number]["value"];
export type LeadsSearchParams = {
  q?: string;
  status?: string;
  sort?: string;
  page?: string;
  attention?: string;
};

export function parseLeadSort(value: string | undefined): LeadSort {
  return leadSortOptions.some((option) => option.value === value)
    ? (value as LeadSort)
    : "updated-desc";
}

export function leadOrderBy(sort: LeadSort): Prisma.LeadOrderByWithRelationInput[] {
  switch (sort) {
    case "updated-asc":
      return [{ updatedAt: "asc" }, { id: "asc" }];
    case "created-desc":
      return [{ createdAt: "desc" }, { id: "desc" }];
    case "created-asc":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "value-desc":
      return [
        { estimatedValue: { sort: "desc", nulls: "last" } },
        { id: "desc" },
      ];
    case "value-asc":
      return [
        { estimatedValue: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ];
    case "name-asc":
      return [{ name: "asc" }, { id: "asc" }];
    case "name-desc":
      return [{ name: "desc" }, { id: "desc" }];
    default:
      return [{ updatedAt: "desc" }, { id: "desc" }];
  }
}

export function buildLeadsQuery(
  ownerId: string,
  params: LeadsSearchParams,
) {
  const query = params.q?.trim().slice(0, 100);
  const status = isLeadStatus(params.status) ? params.status : undefined;
  const sort = parseLeadSort(params.sort);
  const attention = parseLeadAttention(params.attention);
  const requestedPage = Number(params.page);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, 10_000)
      : 1;

  return {
    status,
    sort,
    page,
    args: {
      where: {
        AND: [
          attention === "untouched"
            ? untouchedLeadWhere(ownerId)
            : { userId: ownerId },
          status ? { status } : {},
        ],
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                { email: { contains: query, mode: "insensitive" as const } },
                { company: { contains: query, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: leadOrderBy(sort),
      skip: (page - 1) * LEADS_PAGE_SIZE,
      take: LEADS_PAGE_SIZE + 1,
    } satisfies Prisma.LeadFindManyArgs,
    attention: attention as LeadAttentionFilter | undefined,
  };
}
