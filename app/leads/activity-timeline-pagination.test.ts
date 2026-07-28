import { describe, expect, it } from "vitest";
import {
  mergeActivityItems,
} from "@/app/leads/activity-timeline-pagination";
import type { ActivityDisplayItem } from "@/lib/activity-presentation";

function item(id: string): ActivityDisplayItem {
  return {
    id,
    type: "LEAD_CREATED",
    glyph: "+",
    title: `Activity ${id}`,
    presentation: { kind: "text", description: null },
    context: null,
    occurredAt: "2026-07-27T12:00:00.000Z",
    relativeTime: "1 minute ago",
    exactTime: "Jul 27, 2026 · 7:00 AM",
    dayKey: "2026-7-27",
    dayLabel: "Today",
    related: null,
  };
}

describe("activity timeline pagination", () => {
  it("appends cursor pages in order and removes initial and retry duplicates", () => {
    const knownIds = new Set(["initial"]);
    const first = mergeActivityItems(
      [],
      [item("older-a"), item("initial"), item("older-b")],
      knownIds,
    );
    expect(first.items.map(({ id }) => id)).toEqual(["older-a", "older-b"]);

    const retry = mergeActivityItems(
      first.items,
      [item("older-a"), item("oldest")],
      knownIds,
    );
    expect(retry.additions.map(({ id }) => id)).toEqual(["oldest"]);
    expect(retry.items.map(({ id }) => id)).toEqual([
      "older-a",
      "older-b",
      "oldest",
    ]);
  });
});
