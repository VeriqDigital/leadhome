import Link from "next/link";
import {
  Activity,
  Bot,
  CalendarClock,
  CheckCircle2,
  Globe2,
  Link2,
  ListChecks,
  Mail,
} from "lucide-react";
import type { ActivityTimelineItem } from "@/lib/activity-service";
import { formatRelativeTime } from "@/lib/lead-format";

const icons = {
  MESSAGE_RECEIVED: Mail,
  WEBSITE_SUBMISSION_RECEIVED: Globe2,
  AI_ANALYSIS_COMPLETED: Bot,
  STATUS_CHANGED: ListChecks,
  FOLLOW_UP_CHANGED: CalendarClock,
  TASK_COMPLETED: CheckCircle2,
  CONVERSATION_LINKED: Link2,
} as const;

function activityHref(activity: ActivityTimelineItem) {
  if (
    activity.conversation &&
    (activity.type.startsWith("MESSAGE_") ||
      activity.type.startsWith("CONVERSATION_") ||
      activity.type.startsWith("AI_"))
  ) {
    return `/inbox?conversation=${encodeURIComponent(activity.conversation.id)}`;
  }
  if (activity.task) {
    return `/tasks/${encodeURIComponent(activity.task.id)}/edit`;
  }
  if (activity.lead) return `/leads/${encodeURIComponent(activity.lead.id)}`;
  if (activity.conversation) {
    return `/inbox?conversation=${encodeURIComponent(activity.conversation.id)}`;
  }
  return null;
}

export function RecentActivity({
  activities,
  now,
}: {
  activities: ActivityTimelineItem[];
  now: Date;
}) {
  if (!activities.length) {
    return (
      <div className="px-6 py-9 text-center">
        <Activity className="mx-auto size-7 text-[#9297a1]" />
        <p className="mt-3 text-sm font-semibold">No recent activity yet</p>
        <p className="mt-1 text-xs text-[#687080]">
          Replies, follow-ups, and important updates will appear here.
        </p>
      </div>
    );
  }
  return (
    <ol className="divide-y divide-black/[0.07] px-6 dark:divide-white/[0.07]">
      {activities.map((activity) => {
        const Icon = icons[activity.type as keyof typeof icons] ?? Activity;
        const href = activityHref(activity);
        const content = (
          <>
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f1f2f4] text-[#666b76] dark:bg-white/[0.06] dark:text-[#b7bbc5]"
            >
              <Icon className="size-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">
                {activity.title}
              </span>
              <span className="mt-1 block truncate text-xs text-[#687080]">
                {activity.lead?.name ??
                  activity.conversation?.subject ??
                  activity.task?.title ??
                  activity.description ??
                  "Related item no longer available"}
              </span>
            </span>
            <time
              dateTime={activity.occurredAt.toISOString()}
              className="ml-auto shrink-0 text-[11px] text-[#777e89]"
            >
              {formatRelativeTime(activity.occurredAt, now)}
            </time>
          </>
        );
        return (
          <li key={activity.id}>
            {href ? (
              <Link
                href={href}
                className="flex min-h-17 items-center gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7770c8]"
              >
                {content}
              </Link>
            ) : (
              <div className="flex min-h-17 items-center gap-3 py-3">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
