import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActivityTimeline,
  activityPresentation,
  type TimelineActivity,
} from "@/app/leads/activity-timeline";

const createdAt = new Date("2026-07-24T21:33:00.000Z");
const now = new Date("2026-07-24T21:39:00.000Z");

function activity(overrides: Partial<TimelineActivity> = {}): TimelineActivity {
  return {
    id: "activity-a",
    type: "LEAD_CREATED",
    title: "Lead created",
    description: "Created manually",
    metadata: null,
    createdAt,
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

  it("renders the legacy empty state", () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline activities={[]} now={now} />,
    );
    expect(html).toContain("This lead has no recorded activity yet.");
    expect(html).toContain("New changes will appear here.");
  });
});
