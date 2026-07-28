import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActivityTimelineItem } from "@/lib/activity-service";
import { RecentActivity } from "@/app/recent-activity";

const now = new Date("2026-07-27T18:00:00.000Z");

function activity(
  overrides: Partial<ActivityTimelineItem> = {},
): ActivityTimelineItem {
  return {
    id: "activity-a",
    type: "LEAD_CREATED",
    actorType: "USER",
    source: "MANUAL",
    title: "Lead created",
    description: "Created manually",
    metadata: null,
    occurredAt: new Date("2026-07-27T17:55:00.000Z"),
    lead: { id: "lead-a", name: "Jane Doe" },
    conversation: null,
    task: null,
    ...overrides,
  };
}

describe("dashboard recent activity", () => {
  it("links conversation, task, and lead activity to the most useful destination", () => {
    const html = renderToStaticMarkup(
      <RecentActivity
        now={now}
        activities={[
          activity({
            id: "message",
            type: "MESSAGE_RECEIVED",
            title: "Lead replied",
            conversation: {
              id: "conversation-a",
              subject: "Proposal follow-up",
            },
          }),
          activity({
            id: "task",
            type: "TASK_COMPLETED",
            title: "Task completed",
            task: { id: "task-a", title: "Send proposal" },
          }),
          activity({
            id: "lead",
            type: "STATUS_CHANGED",
            title: "Status changed",
          }),
        ]}
      />,
    );

    expect(html).toContain('href="/inbox?conversation=conversation-a"');
    expect(html).toContain('href="/tasks/task-a/edit"');
    expect(html).toContain('href="/leads/lead-a"');
    expect(html).toContain("Lead replied");
    expect(html).toContain("5 minutes ago");
    expect(html).toContain('dateTime="2026-07-27T17:55:00.000Z"');
  });

  it("renders missing related data without creating a dead link", () => {
    const html = renderToStaticMarkup(
      <RecentActivity
        now={now}
        activities={[
          activity({
            lead: null,
            conversation: null,
            task: null,
            description: null,
            title: "Historical activity",
          }),
        ]}
      />,
    );

    expect(html).not.toContain("<a");
    expect(html).toContain("Related item no longer available");
  });

  it("renders a friendly empty state", () => {
    const html = renderToStaticMarkup(
      <RecentActivity activities={[]} now={now} />,
    );

    expect(html).toContain("No recent activity yet");
    expect(html).toContain(
      "Replies, follow-ups, and important updates will appear here.",
    );
  });

  it("is wired into the dashboard with an owner-scoped activity query", () => {
    const dashboard = readFileSync(
      join(process.cwd(), "app/page.tsx"),
      "utf8",
    );

    expect(dashboard).toContain("getDashboardRecentActivities(user.id)");
    expect(dashboard).toContain('title="Recent Activity"');
    expect(dashboard).toContain(
      "<RecentActivity activities={recentActivity} now={now} />",
    );
  });
});
