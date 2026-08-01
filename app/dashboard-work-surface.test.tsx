import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DashboardAttention } from "@/lib/dashboard/attention";
import {
  AttentionError,
  DashboardLoading,
  NeedsAttention,
  TodaysWork,
} from "./dashboard-work-surface";

const now = new Date("2026-07-31T17:00:00.000Z");
const attention = (): DashboardAttention => ({
  categories: [
    {
      key: "AWAITING_RESPONSE",
      title: "Customers waiting for a reply",
      explanation: "Latest message is inbound.",
      count: 3,
      countIsLowerBound: false,
      severity: "urgent",
      href: "/inbox?attention=awaiting-response",
      actionLabel: "Open Inbox",
    },
    {
      key: "OVERDUE_WORK",
      title: "Follow-ups and tasks overdue",
      explanation: "Open tasks are overdue.",
      count: 0,
      countIsLowerBound: false,
      severity: "urgent",
      href: "/tasks?view=overdue",
      actionLabel: "Open tasks",
    },
  ],
  workItems: [
    {
      id: "reply:conversation-a",
      category: "AWAITING_RESPONSE",
      title: "Alice",
      action: "Reply to customer",
      context: "Acme",
      relevantAt: new Date("2026-07-31T12:00:00.000Z"),
      href: "/inbox?attention=awaiting-response&conversation=conversation-a",
    },
  ],
  totalCount: 3,
  totalCountIsLowerBound: false,
  caughtUp: false,
});

describe("dashboard work surface", () => {
  it("renders Needs Attention first as ranked accessible action rows", () => {
    const markup = renderToStaticMarkup(
      <NeedsAttention attention={attention()} />,
    );
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Customers waiting for a reply");
    expect(markup).toContain("3 actionable items");
    expect(markup).toContain('href="/inbox?attention=awaiting-response"');
    expect(markup).toContain(
      'aria-label="3 Customers waiting for a reply. Open Inbox"',
    );
    expect(markup).not.toContain("Follow-ups and tasks overdue");
  });

  it("renders the positive zero-attention state", () => {
    const empty = attention();
    empty.categories = empty.categories.map((category) => ({
      ...category,
      count: 0,
    }));
    empty.workItems = [];
    empty.totalCount = 0;
    empty.totalCountIsLowerBound = false;
    empty.caughtUp = true;
    const markup = renderToStaticMarkup(<NeedsAttention attention={empty} />);
    expect(markup).toContain("You are caught up");
    expect(markup).toContain(
      "No leads, tasks, or conversations currently require action.",
    );
  });

  it("renders a bounded direct-record Today's Work list", () => {
    const markup = renderToStaticMarkup(
      <TodaysWork attention={attention()} now={now} />,
    );
    expect(markup).toContain("Today&#x27;s work");
    expect(markup).toContain("Reply to customer");
    expect(markup).toContain("Alice");
    expect(markup).toContain(
      'href="/inbox?attention=awaiting-response&amp;conversation=conversation-a"',
    );
    expect(markup).toContain('aria-label="Reply to customer: Alice"');
  });

  it("announces loading and isolated error states", () => {
    expect(renderToStaticMarkup(<DashboardLoading />)).toContain(
      'role="status"',
    );
    const error = renderToStaticMarkup(<AttentionError />);
    expect(error).toContain('role="alert"');
    expect(error).toContain("Open Inbox");
    expect(error).toContain("Open Leads");
    expect(error).toContain("Open Tasks");
  });

  it("keeps mobile information order action-first without horizontal scrolling", () => {
    const markup = renderToStaticMarkup(
      <NeedsAttention attention={attention()} />,
    );
    expect(markup.indexOf("Customers waiting for a reply")).toBeLessThan(
      markup.indexOf("Open Inbox"),
    );
    expect(markup).not.toContain("overflow-x");
  });
});
