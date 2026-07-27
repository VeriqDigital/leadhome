"use client";

export function TaskDue({
  dueAt,
  overdue,
}: {
  dueAt: string | null;
  overdue: boolean;
}) {
  if (!dueAt) return <span className="text-[#687080]">No due date</span>;
  const date = new Date(dueAt);
  return (
    <time
      dateTime={dueAt}
      className={overdue ? "font-semibold text-red-600 dark:text-red-400" : "text-[#687080]"}
    >
      {overdue ? "Overdue · " : ""}
      {new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: date.getHours() === 12 && date.getMinutes() === 0 ? undefined : "short",
      }).format(date)}
    </time>
  );
}
