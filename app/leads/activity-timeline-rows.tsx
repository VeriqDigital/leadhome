import type { ActivityDisplayItem } from "@/lib/activity-presentation";

function TimelineStatusBadge({ status }: { status: string }) {
  const styles =
    status === "New"
      ? "bg-[#efedfb] text-[#5449ae]"
      : status === "Contacted"
        ? "bg-[#fff4da] text-[#9a6500]"
        : "bg-[#fff0e8] text-[#b34f20]";
  return (
    <span
      className={`inline-flex rounded-lg px-3 py-1.5 text-[11px] font-medium ${styles}`}
    >
      {status}
    </span>
  );
}

function RelatedActivity({ activity }: { activity: ActivityDisplayItem }) {
  if (!activity.related) return null;
  if (activity.related.kind === "missing") {
    return (
      <p className="mt-2 text-[11px] text-[#8b909a]">
        {activity.related.label}
      </p>
    );
  }
  return (
    <a
      href={activity.related.href}
      className="mt-2 inline-flex min-h-9 items-center text-[11px] font-semibold text-[#625bab] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7770c8] dark:text-[#aaa4f0]"
    >
      {activity.related.label}
    </a>
  );
}

export function ActivityTimelineRows({
  items,
  previousDayKey = null,
  label,
  busy = false,
}: {
  items: ActivityDisplayItem[];
  previousDayKey?: string | null;
  label?: string;
  busy?: boolean;
}) {
  return (
    <ol
      className="px-5 py-2 sm:px-6"
      aria-label={label}
      aria-busy={busy}
    >
      {items.map((activity, index) => {
        const previous =
          index === 0 ? previousDayKey : items[index - 1]!.dayKey;
        const startsDay = previous !== activity.dayKey;
        return (
          <li key={activity.id}>
            {startsDay && (
              <h3 className="border-b border-black/[0.06] pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wide text-[#777e89] dark:border-white/[0.07]">
                {activity.dayLabel}
              </h3>
            )}
            <article className="relative grid grid-cols-[30px_minmax(0,1fr)] gap-3 py-4.5">
              <span
                aria-hidden="true"
                className="relative z-10 grid size-7.5 place-items-center rounded-full border border-black/[0.07] bg-[#f4f4f5] text-[9px] font-bold text-[#666b76] dark:border-white/10 dark:bg-[#292b31] dark:text-[#b7bbc5]"
              >
                {activity.glyph}
              </span>
              <div className="min-w-0">
                <h4 className="break-words text-[13px] font-semibold leading-5">
                  {activity.title}
                </h4>
                {activity.presentation.kind === "status" ? (
                  <div
                    className="mt-2 flex flex-wrap items-center gap-1.5"
                    aria-label={activity.presentation.description}
                  >
                    <span aria-hidden="true">
                      <TimelineStatusBadge
                        status={activity.presentation.from}
                      />
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-xs text-[#8b909a]"
                    >
                      →
                    </span>
                    <span aria-hidden="true">
                      <TimelineStatusBadge status={activity.presentation.to} />
                    </span>
                  </div>
                ) : (
                  activity.presentation.description && (
                    <p className="mt-1 break-words text-xs leading-5 text-[#687080]">
                      {activity.presentation.description}
                    </p>
                  )
                )}
                {activity.presentation.kind === "text" &&
                  activity.presentation.detail && (
                    <p className="mt-0.5 text-[11px] text-[#8b909a]">
                      {activity.presentation.detail}
                    </p>
                  )}
                {activity.context && (
                  <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-[#8b909a]">
                    {activity.context}
                  </p>
                )}
                <RelatedActivity activity={activity} />
                <time
                  dateTime={activity.occurredAt}
                  aria-label={`${activity.relativeTime}. ${activity.exactTime}`}
                  className="mt-1 block"
                >
                  <span className="block text-[11px] font-medium text-[#747b88]">
                    {activity.relativeTime}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[#969ba5]">
                    {activity.exactTime}
                  </span>
                </time>
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
