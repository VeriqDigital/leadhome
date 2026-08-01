import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  lead: { findFirst: vi.fn() },
  task: { findMany: vi.fn() },
  conversation: { findMany: vi.fn() },
}));
const activity = vi.hoisted(() => ({
  getPage: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(),
}));
const gmail = vi.hoisted(() => ({
  getConnectedGmailAddress: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: database }));
vi.mock("@/lib/auth-user", () => ({
  requireUser: vi.fn(async () => ({ id: "owner-a" })),
}));
vi.mock("@/lib/activity-service", () => ({
  getLeadActivityPage: activity.getPage,
}));
vi.mock("@/lib/tasks/task-service", () => ({
  isOverdue: vi.fn(() => false),
}));
vi.mock("@/lib/gmail/connected-account", () => gmail);
vi.mock("@/app/actions/lead-actions", () => ({
  deleteLeadAction: vi.fn(),
  markLeadContactedAction: vi.fn(),
  updateLeadAction: vi.fn(),
}));
vi.mock("@/app/actions/task-actions", () => ({
  createTaskAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: navigation.notFound,
}));

import LeadDetailPage from "./page";

const leadId = "cm123456789012345678901234";
const followUp = new Date(2026, 7, 12, 12);

beforeEach(() => {
  gmail.getConnectedGmailAddress.mockResolvedValue("owner@example.com");
  database.lead.findFirst.mockResolvedValue({
    id: leadId,
    userId: "owner-a",
    name: "Persisted follow-up lead",
    email: "lead@example.com",
    phone: null,
    company: "Acme",
    source: "MANUAL",
    status: "FOLLOW_UP",
    message: null,
    estimatedValue: null,
    nextFollowUpDate: followUp,
    createdAt: new Date("2026-07-20T12:00:00.000Z"),
    updatedAt: new Date("2026-07-27T12:00:00.000Z"),
  });
  database.task.findMany.mockResolvedValue([
    {
      id: "cm987654321098765432109876",
      title: "Call the customer",
      type: "FOLLOW_UP",
      status: "OPEN",
      dueAt: followUp,
    },
  ]);
  database.conversation.findMany.mockResolvedValue([]);
  activity.getPage.mockResolvedValue({
    items: [
      {
        id: "cm555555555555555555555555",
        type: "FOLLOW_UP_CHANGED",
        actorType: "SYSTEM",
        source: "TASK",
        title: "Follow-up scheduled",
        description: "Updated from open follow-up tasks",
        metadata: {
          from: null,
          to: followUp.toISOString(),
        },
        occurredAt: new Date("2026-07-27T12:00:00.000Z"),
        lead: { id: leadId, name: "Persisted follow-up lead" },
        conversation: null,
        task: { id: "cm987654321098765432109876", title: "Call the customer" },
      },
    ],
    nextCursor: null,
  });
});

async function renderPage() {
  return renderToStaticMarkup(
    await LeadDetailPage({ params: Promise.resolve({ id: leadId }) }),
  );
}

describe("lead detail persisted follow-up rendering", () => {
  it("renders the derived date, task, and initial activity on the server", async () => {
    const html = await renderPage();

    expect(html).toContain('name="nextFollowUp"');
    expect(html).toContain('value="2026-08-12"');
    expect(html).toContain("Call the customer");
    expect(html).toContain("Follow-up scheduled");
    expect(html).toContain("Contact in Gmail");
    expect(html).not.toContain("Mark as contacted");
    expect(html).toContain("recognized after the next Gmail check");
    expect(html).toContain("authuser=owner%40example.com");
    expect(html).toContain("to=lead%40example.com");
    expect(html).toContain('aria-label="Activity history"');
    expect(html).not.toContain('aria-label="Loading activity history"');
    expect(activity.getPage).toHaveBeenCalledWith({
      leadId,
      ownerId: "owner-a",
    });
    expect(gmail.getConnectedGmailAddress).toHaveBeenCalledWith("owner-a");
    expect(navigation.notFound).not.toHaveBeenCalled();
  });

  it("shows manual contact only while the lead is still New", async () => {
    database.lead.findFirst.mockResolvedValue({
      ...(await database.lead.findFirst()),
      status: "NEW",
    });
    expect(await renderPage()).toContain("Mark as contacted");
  });

  it("is read-only across repeated renders and has no automatic refresh lifecycle", async () => {
    await renderPage();
    await renderPage();

    expect(database.lead.findFirst).toHaveBeenCalledTimes(2);
    expect(database.task.findMany).toHaveBeenCalledTimes(2);
    expect(activity.getPage).toHaveBeenCalledTimes(2);

    const source = [
      readFileSync(new URL("./page.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../lead-form.tsx", import.meta.url), "utf8"),
      readFileSync(
        new URL("../activity-timeline.tsx", import.meta.url),
        "utf8",
      ),
      readFileSync(
        new URL("../activity-timeline-pagination.tsx", import.meta.url),
        "utf8",
      ),
      readFileSync(new URL("../../tasks/task-form.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../../tasks/task-due.tsx", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).not.toMatch(
      /router\.(?:refresh|push|replace)|location\.(?:reload|assign|replace)/,
    );
    expect(source).not.toContain(
      'key={`${lead.id}:${lead.updatedAt.toISOString()}:${lead.nextFollowUpDate?.toISOString() ?? "none"}`}',
    );
    expect(source).not.toContain('"use client";\n\nexport function TaskDue');
    expect(source).not.toContain("ssr: false");
    expect(source).not.toContain("LazyActivityTimeline");
    expect(source).toContain("ActivityTimeline");
  });
});
