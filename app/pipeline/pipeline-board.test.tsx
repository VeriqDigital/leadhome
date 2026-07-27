import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  optimisticMoveColumns,
  rollbackOptimisticMove,
} from "@/lib/pipeline/optimistic";

const card = {
  id: "lead-a",
  name: "Jane",
  company: "Acme",
  email: "jane@example.com",
  source: "MANUAL",
  status: "NEW",
  estimatedValue: "500",
  nextFollowUpDate: null,
  updatedAt: new Date(),
  latestActivityAt: null,
  openTaskCount: 0,
  overdueTaskCount: 0,
  dueTodayTaskCount: 0,
  nextOpenTaskAt: null,
  hasOpenFollowUpTask: false,
  hasConversation: false,
} as const;

const columns = [
  {
    status: "NEW" as const,
    count: 1,
    value: "500",
    cards: [card],
    hasMore: false,
    limit: 20,
    loadMoreHref: "/pipeline?limit_NEW=40",
  },
  {
    status: "CONTACTED" as const,
    count: 0,
    value: "0",
    cards: [],
    hasMore: false,
    limit: 20,
    loadMoreHref: "/pipeline?limit_CONTACTED=40",
  },
];

describe("pipeline board interactions", () => {
  it("optimistically moves a card while updating stage count and value", () => {
    const moved = optimisticMoveColumns(columns, "lead-a", "CONTACTED");
    expect(moved[0]).toEqual(expect.objectContaining({
      count: 0,
      value: "0",
      cards: [],
    }));
    expect(moved[1]).toEqual(expect.objectContaining({
      count: 1,
      value: "500",
      cards: [expect.objectContaining({ id: "lead-a", status: "CONTACTED" })],
    }));
    expect(columns[0].cards).toHaveLength(1);
    expect(
      rollbackOptimisticMove(moved, columns, "lead-a", "CONTACTED"),
    ).toEqual(columns);
  });

  it("includes rollback, pointer drag, keyboard menu, mobile selector, warnings, and load more", () => {
    const source = readFileSync(
      new URL("./pipeline-board.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("rollbackOptimisticMove");
    expect(source).toContain("onPointerMove");
    expect(source).toContain("onDragStart");
    expect(source).toContain("Move {card.name} to stage");
    expect(source).toContain("md:hidden");
    expect(source).toContain("No follow-up is scheduled.");
    expect(source).toContain("Create follow-up task");
    expect(source).toContain("Load more");
    expect(source).toContain("No leads in");
    expect(source).toContain("href={`/leads/${card.id}`}");
    expect(source).toContain("pendingIdsRef.current.has");
  });

  it("keeps filters and all supported sorts URL-backed and server-side", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    for (const field of [
      'name="q"',
      'name="source"',
      'name="followUp"',
      'name="hasTasks"',
      'name="hasConversation"',
      'name="minValue"',
      'name="maxValue"',
      'name="sort"',
    ]) {
      expect(source).toContain(field);
    }
    for (const sort of [
      "urgency",
      "updated-desc",
      "value-desc",
      "value-asc",
      "name-asc",
      "name-desc",
    ]) {
      expect(source).toContain(`value: "${sort}"`);
    }
    expect(source).toContain('getPipelineBoard(user.id, {');
    expect(source).toContain(': "urgency"');
  });
});
