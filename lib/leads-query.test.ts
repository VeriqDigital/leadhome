import { describe, expect, it } from "vitest";
import {
  LEADS_PAGE_SIZE,
  buildLeadsQuery,
  leadOrderBy,
  parseLeadSort,
} from "./leads-query";

describe("leads query", () => {
  it("defaults invalid and missing sorts to stable recently-updated order", () => {
    expect(parseLeadSort(undefined)).toBe("updated-desc");
    expect(parseLeadSort("invalid")).toBe("updated-desc");
    expect(leadOrderBy("updated-desc")).toEqual([
      { updatedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("supports updated and created ordering in both directions", () => {
    expect(leadOrderBy("updated-asc")).toEqual([
      { updatedAt: "asc" },
      { id: "asc" },
    ]);
    expect(leadOrderBy("created-desc")).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(leadOrderBy("created-asc")).toEqual([
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("sorts null values last for both value directions", () => {
    expect(leadOrderBy("value-desc")[0]).toEqual({
      estimatedValue: { sort: "desc", nulls: "last" },
    });
    expect(leadOrderBy("value-asc")[0]).toEqual({
      estimatedValue: { sort: "asc", nulls: "last" },
    });
  });

  it("supports stable alphabetical ordering", () => {
    expect(leadOrderBy("name-asc")).toEqual([
      { name: "asc" },
      { id: "asc" },
    ]);
    expect(leadOrderBy("name-desc")).toEqual([
      { name: "desc" },
      { id: "desc" },
    ]);
  });

  it("combines owner scope, search, filter, sorting, and pagination", () => {
    const result = buildLeadsQuery("owner-a", {
      q: " Acme ",
      status: "CONTACTED",
      sort: "value-desc",
      page: "3",
    });
    expect(result.args.where).toEqual(expect.objectContaining({
      userId: "owner-a",
      status: "CONTACTED",
      OR: expect.arrayContaining([
        { name: { contains: "Acme", mode: "insensitive" } },
      ]),
    }));
    expect(result.args.orderBy).toEqual(leadOrderBy("value-desc"));
    expect(result.args.skip).toBe(LEADS_PAGE_SIZE * 2);
    expect(result.args.take).toBe(LEADS_PAGE_SIZE + 1);
  });

  it("never broadens owner scope for invalid inputs", () => {
    const result = buildLeadsQuery("owner-b", {
      status: "not-a-status",
      sort: "not-a-sort",
      page: "-1",
    });
    expect(result.args.where).toEqual({ userId: "owner-b", status: undefined });
    expect(result.sort).toBe("updated-desc");
    expect(result.page).toBe(1);
  });
});
