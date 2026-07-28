import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActivityTimeline,
  activityPresentation,
  type TimelineActivity,
} from "@/app/leads/activity-timeline";

const occurredAt = new Date("2026-07-24T21:33:00.000Z");
const now = new Date("2026-07-24T21:39:00.000Z");

function activity(overrides: Partial<TimelineActivity> = {}): TimelineActivity {
  return {
    id: "activity-a",
    type: "LEAD_CREATED",
    title: "Lead created",
    description: "Created manually",
    metadata: null,
    occurredAt,
    ...overrides,
  };
}

describe("activity presentation formatting", () => {
  it("formats readable status transitions from metadata", () => {
    expect(activityPresentation(activity({
      type: "STATUS_CHANGED",
      metadata: { from: "NEW", to: "PROPOSAL_SENT" },
    }))).toEqual({
      kind: "status",
      from: "New",
      to: "Proposal sent",
      description: "New → Proposal sent",
    });
  });

  it("formats null-to-value and value-to-null currency transitions", () => {
    expect(activityPresentation(activity({
      type: "ESTIMATED_VALUE_CHANGED",
      metadata: { from: null, to: 3500 },
    }))).toEqual({ kind: "text", description: "No value → $3,500" });
    expect(activityPresentation(activity({
      type: "ESTIMATED_VALUE_CHANGED",
      metadata: { from: 7500, to: null },
    }))).toEqual({ kind: "text", description: "$7,500 → No value" });
  });

  it("formats follow-up transitions without timezone date shifts", () => {
    expect(activityPresentation(activity({
      type: "FOLLOW_UP_CHANGED",
      metadata: { from: null, to: "2026-08-12T12:00:00.000Z" },
    }))).toEqual({ kind: "text", description: "No date → Aug 12, 2026" });
    expect(activityPresentation(activity({
      type: "FOLLOW_UP_CHANGED",
      metadata: { from: "2026-08-18T12:00:00.000Z", to: null },
    }))).toEqual({ kind: "text", description: "Aug 18, 2026 → No date" });
  });

  it("falls back to stored descriptions for missing or malformed metadata", () => {
    expect(activityPresentation(activity({
      type: "ESTIMATED_VALUE_CHANGED",
      description: "Legacy value update",
    }))).toEqual({ kind: "text", description: "Legacy value update" });
    expect(activityPresentation(activity({
      type: "FOLLOW_UP_CHANGED",
      description: "Legacy follow-up update",
      metadata: { from: {}, to: [] },
    }))).toEqual({ kind: "text", description: "Legacy follow-up update" });
  });

  it("summarizes contact fields and formats company and source transitions", () => {
    expect(activityPresentation(activity({
      type: "CONTACT_INFO_CHANGED",
      metadata: { name: {}, email: {}, phone: {} },
    }))).toEqual({
      kind: "text",
      description: "Name, email, and phone updated",
    });
    expect(activityPresentation(activity({
      type: "COMPANY_CHANGED",
      metadata: { from: null, to: "Veriq Digital" },
    }))).toEqual({
      kind: "text",
      description: "No company → Veriq Digital",
    });
    expect(activityPresentation(activity({
      type: "SOURCE_CHANGED",
      metadata: { from: "WEBSITE", to: "MANUAL" },
    }))).toEqual({
      kind: "text",
      description: "Website → Manual",
    });
  });
});

describe("activity timeline rendering", () => {
  it("renders semantic ordered items, status badges, and exact and relative times", () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline
        now={now}
        activities={[
          activity({
            type: "STATUS_CHANGED",
            title: "Status changed",
            metadata: { from: "NEW", to: "CONTACTED" },
          }),
        ]}
      />,
    );

    expect(html).toContain("<ol");
    expect(html).toContain("<li");
    expect(html).toContain("New");
    expect(html).toContain("Contacted");
    expect(html).toContain("6 minutes ago");
    expect(html).toContain("Jul 24, 2026 ·");
    expect(html).toContain('dateTime="2026-07-24T21:33:00.000Z"');
  });

  it("uses occurred-at for display and groups events by activity date", () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline
        now={now}
        activities={[
          activity({
            id: "today-new",
            title: "Newest today",
            occurredAt: new Date("2026-07-24T21:33:00.000Z"),
            createdAt: new Date("2026-07-27T12:00:00.000Z"),
          }),
          activity({
            id: "today-old",
            title: "Older today",
            occurredAt: new Date("2026-07-24T16:00:00.000Z"),
          }),
          activity({
            id: "yesterday",
            title: "Yesterday event",
            occurredAt: new Date("2026-07-23T18:00:00.000Z"),
          }),
          activity({
            id: "older",
            title: "Older event",
            occurredAt: new Date("2026-07-20T18:00:00.000Z"),
          }),
        ]}
      />,
    );

    expect(html.match(/>Today</g)).toHaveLength(1);
    expect(html.match(/>Yesterday</g)).toHaveLength(1);
    expect(html).toContain("July 20, 2026");
    expect(html).toContain('dateTime="2026-07-24T21:33:00.000Z"');
    expect(html).not.toContain('dateTime="2026-07-27T12:00:00.000Z"');
  });

  it("uses the supplied time zone consistently for date grouping", () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline
        now="2026-07-25T00:30:00.000Z"
        timeZone="America/Los_Angeles"
        activities={[
          activity({
            occurredAt: new Date("2026-07-24T23:30:00.000Z"),
          }),
        ]}
      />,
    );

    expect(html).toContain(">Today<");
    expect(html).not.toContain(">Yesterday<");
    expect(html).toContain("Jul 24, 2026");
  });

  it("renders source and actor context plus related entity links", () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline
        now={now}
        activities={[
          activity({
            id: "message",
            type: "MESSAGE_RECEIVED",
            title: "New email received",
            source: "GMAIL",
            actorType: "CONTACT",
            conversation: {
              id: "conversation-a",
              subject: "Pricing question",
            },
          }),
          activity({
            id: "task",
            type: "TASK_COMPLETED",
            title: "Task completed",
            source: "TASK",
            actorType: "USER",
            task: { id: "task-a", title: "Send proposal" },
          }),
        ]}
      />,
    );

    expect(html).toContain("Gmail");
    expect(html).toContain("Contact");
    expect(html).toContain('href="/inbox?conversation=conversation-a"');
    expect(html).toContain("Open conversation");
    expect(html).toContain('href="/tasks/task-a/edit"');
    expect(html).toContain("Open task");
  });

  it("explains when a related entity is no longer available", () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline
        now={now}
        activities={[
          activity({
            type: "TASK_DELETED",
            title: "Task deleted",
            task: null,
          }),
          activity({
            id: "removed-conversation",
            type: "CONVERSATION_UNLINKED",
            title: "Conversation detached",
            conversation: null,
          }),
        ]}
      />,
    );

    expect(html).toContain("Related task is no longer available.");
    expect(html).toContain("Related conversation is no longer available.");
  });

  it("preserves supplied newest-first order", () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline
        now={now}
        activities={[
          activity({ id: "new", title: "Newest event" }),
          activity({ id: "old", title: "Older event" }),
        ]}
      />,
    );
    expect(html.indexOf("Newest event")).toBeLessThan(html.indexOf("Older event"));
  });

  it("does not crash for unknown types and null descriptions", () => {
    expect(() =>
      renderToStaticMarkup(
        <ActivityTimeline
          now={now}
          activities={[
            activity({
              type: "FUTURE_ACTIVITY",
              title: "Future event",
              description: null,
              metadata: { unexpected: true },
            }),
          ]}
        />,
      ),
    ).not.toThrow();
  });

  it("renders the unified activity empty state", () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline activities={[]} now={now} />,
    );
    expect(html).toContain("This lead has no recorded activity yet.");
    expect(html).toContain("New business events will appear here.");
  });

  it("server-renders the initial page and isolates only cursor pagination", () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline
        leadId="cm123456789012345678901234"
        nextCursor="activity-next"
        activities={[activity()]}
        now={now}
      />,
    );

    expect(html).toContain("Lead created");
    expect(html).toContain("Load older activity");
    expect(html).not.toContain("Loading activity history");

    const serverSource = readFileSync(
      new URL("./activity-timeline.tsx", import.meta.url),
      "utf8",
    );
    const paginationSource = readFileSync(
      new URL("./activity-timeline-pagination.tsx", import.meta.url),
      "utf8",
    );
    expect(serverSource).not.toContain('"use client"');
    expect(serverSource).not.toContain("next/dynamic");
    expect(serverSource).not.toContain("lucide-react");
    expect(serverSource).not.toContain("@/app/components");
    expect(paginationSource).toContain('"use client"');
    expect(paginationSource).not.toContain("next/dynamic");
    expect(paginationSource).not.toContain("lucide-react");
    expect(paginationSource).not.toContain("@/app/components");
  });
});
