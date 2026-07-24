import type { LeadActivityType } from "@prisma/client";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarClock,
  CircleDollarSign,
  ClipboardPenLine,
  ContactRound,
  Globe2,
  ListChecks,
  UserRoundPlus,
  Waypoints,
} from "lucide-react";
import { formatDateTime, formatRelativeTime } from "@/lib/lead-format";

const icons: Record<LeadActivityType, LucideIcon> = {
  LEAD_CREATED: UserRoundPlus,
  WEBSITE_SUBMISSION_RECEIVED: Globe2,
  STATUS_CHANGED: ListChecks,
  ESTIMATED_VALUE_CHANGED: CircleDollarSign,
  FOLLOW_UP_CHANGED: CalendarClock,
  CONTACT_INFO_CHANGED: ContactRound,
  COMPANY_CHANGED: Building2,
  NOTES_CHANGED: ClipboardPenLine,
  SOURCE_CHANGED: Waypoints,
};

type Activity = {
  id: string;
  type: LeadActivityType;
  title: string;
  description: string | null;
  createdAt: Date;
};

export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  return (
    <aside className="dashboard-card rounded-2xl border border-black/5.5 bg-white shadow-[0_8px_30px_rgba(23,24,28,0.035)] lg:sticky lg:top-6">
      <header className="border-b border-black/6 px-6 py-5">
        <h2 className="text-[15px] font-semibold">Activity</h2>
        <p className="mt-1 text-xs text-[#687080]">History for this lead.</p>
      </header>
      {activities.length ? (
        <ol className="px-6 py-2">
          {activities.map((activity, index) => {
            const Icon = icons[activity.type];
            const exact = formatDateTime(activity.createdAt);
            return (
              <li
                key={activity.id}
                className="relative grid grid-cols-[32px_1fr] gap-3 py-4"
              >
                {index < activities.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute bottom-[-16px] left-[15px] top-10 w-px bg-black/[0.08] dark:bg-white/[0.09]"
                  />
                )}
                <span className="relative z-10 grid size-8 place-items-center rounded-full border border-black/[0.07] bg-[#f4f4f5] text-[#666b76] dark:border-white/10 dark:bg-[#292b31] dark:text-[#b7bbc5]">
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 pt-0.5">
                  <h3 className="text-[13px] font-semibold">{activity.title}</h3>
                  {activity.description && (
                    <p className="mt-1 text-xs leading-5 text-[#687080]">
                      {activity.description}
                    </p>
                  )}
                  <time
                    dateTime={activity.createdAt.toISOString()}
                    title={exact}
                    className="mt-1.5 block text-[11px] text-[#8b909a]"
                  >
                    {formatRelativeTime(activity.createdAt)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-6 py-10 text-center text-sm text-[#687080]">
          This lead has no recorded activity yet.
        </p>
      )}
    </aside>
  );
}
