import {
  activityPresentation,
  presentActivities,
  type TimelineActivity,
} from "@/lib/activity-presentation";
import { ActivityTimelinePagination } from "./activity-timeline-pagination";
import { ActivityTimelineRows } from "./activity-timeline-rows";

export { activityPresentation };
export type { TimelineActivity };

export function ActivityTimeline({
  activities,
  nextCursor = null,
  leadId = "",
  now,
  timeZone = "UTC",
}: {
  activities: TimelineActivity[];
  nextCursor?: string | null;
  leadId?: string;
  now: Date | string;
  timeZone?: string;
}) {
  const nowValue = now instanceof Date ? now.toISOString() : now;
  const displayed = presentActivities({
    activities,
    now: nowValue,
    timeZone,
  });
  const lastDayKey = displayed.at(-1)?.dayKey ?? null;

  return (
    <aside className="dashboard-card overflow-hidden rounded-2xl border border-black/5.5 bg-white shadow-[0_8px_30px_rgba(23,24,28,0.035)] lg:sticky lg:top-6">
      <header className="border-b border-black/6 px-6 py-5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
          Activity
        </h2>
        <p className="mt-1 text-xs text-[#687080]">
          Important history for this lead.
        </p>
      </header>
      {displayed.length ? (
        <>
          <ActivityTimelineRows
            items={displayed}
            label="Activity history"
          />
          {nextCursor && leadId ? (
            <ActivityTimelinePagination
              key={`${leadId}:${displayed[0]!.id}`}
              leadId={leadId}
              initialCursor={nextCursor}
              initialActivityIds={displayed.map((activity) => activity.id)}
              previousDayKey={lastDayKey}
              now={nowValue}
              timeZone={timeZone}
            />
          ) : (
            <div className="border-t border-black/[0.06] px-6 py-4 dark:border-white/[0.07]">
              <p className="text-center text-[11px] text-[#969ba5]">
                You&apos;ve reached the beginning of this history.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="px-6 py-11 text-center">
          <p className="text-sm text-[#687080]">
            This lead has no recorded activity yet.
          </p>
          <p className="mt-1 text-xs text-[#969ba5]">
            New business events will appear here.
          </p>
        </div>
      )}
    </aside>
  );
}
