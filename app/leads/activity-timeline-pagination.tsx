"use client";

import { useRef, useState } from "react";
import type { ActivityDisplayItem } from "@/lib/activity-presentation";
import { ActivityTimelineRows } from "./activity-timeline-rows";

export function mergeActivityItems(
  current: ActivityDisplayItem[],
  incoming: ActivityDisplayItem[],
  knownIds: Set<string>,
) {
  const additions = incoming.filter((activity) => {
    if (knownIds.has(activity.id)) return false;
    knownIds.add(activity.id);
    return true;
  });
  return {
    additions,
    items: [...current, ...additions],
  };
}

export function ActivityTimelinePagination({
  leadId,
  initialCursor,
  initialActivityIds,
  previousDayKey,
  now,
  timeZone,
}: {
  leadId: string;
  initialCursor: string;
  initialActivityIds: string[];
  previousDayKey: string | null;
  now: string;
  timeZone: string;
}) {
  const knownIds = useRef(new Set(initialActivityIds));
  const [items, setItems] = useState<ActivityDisplayItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const loadMore = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    setAnnouncement("Loading older activity.");
    try {
      const query = new URLSearchParams({
        cursor: nextCursor,
        now,
        timeZone,
      });
      const response = await fetch(
        `/api/leads/${encodeURIComponent(leadId)}/activities?${query}`,
        { cache: "no-store", headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error("Activity request failed.");
      const page = (await response.json()) as {
        items?: ActivityDisplayItem[];
        nextCursor?: string | null;
      };
      if (
        !Array.isArray(page.items) ||
        !page.items.every(
          (activity) =>
            activity &&
            typeof activity.id === "string" &&
            typeof activity.title === "string" &&
            typeof activity.occurredAt === "string",
        ) ||
        (page.nextCursor !== null &&
          page.nextCursor !== undefined &&
          typeof page.nextCursor !== "string")
      ) {
        throw new Error("Activity response was invalid.");
      }
      const merged = mergeActivityItems(items, page.items, knownIds.current);
      setItems(merged.items);
      setNextCursor(page.nextCursor ?? null);
      setAnnouncement(
        merged.additions.length
          ? `${merged.additions.length} older ${merged.additions.length === 1 ? "activity" : "activities"} loaded.`
          : "No additional activity was added.",
      );
    } catch {
      setError("Older activity could not be loaded. Please try again.");
      setAnnouncement("Older activity could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-label="Older activity" aria-busy={loading}>
      {items.length > 0 && (
        <ActivityTimelineRows
          items={items}
          previousDayKey={previousDayKey}
          label="Previously recorded activity"
          busy={loading}
        />
      )}
      <div className="border-t border-black/[0.06] px-6 py-4 dark:border-white/[0.07]">
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        {error && (
          <p
            role="alert"
            className="mb-3 text-xs text-red-700 dark:text-red-300"
          >
            {error}
          </p>
        )}
        {nextCursor ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="min-h-11 w-full cursor-pointer rounded-xl border border-black/10 px-4 text-xs font-semibold hover:bg-black/[0.03] disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/[0.05]"
          >
            {loading
              ? "Loading older activity…"
              : error
                ? "Try again"
                : "Load older activity"}
          </button>
        ) : (
          <p
            aria-live="polite"
            className="text-center text-[11px] text-[#969ba5]"
          >
            You&apos;ve reached the beginning of this history.
          </p>
        )}
      </div>
    </section>
  );
}
