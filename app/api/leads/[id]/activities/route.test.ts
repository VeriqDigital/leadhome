import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getPage: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/activity-service", () => ({
  getLeadActivityPage: mocks.getPage,
}));
vi.mock("@/lib/server-errors", () => ({
  reportOperationalError: mocks.reportError,
}));

import { GET } from "./route";

const leadId = "cm123456789012345678901234";
const cursor = "cm123456789012345678901235";
const context = (id = leadId) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner-a" } });
  mocks.getPage.mockResolvedValue({ items: [], nextCursor: null });
});

describe("GET /api/leads/[id]/activities", () => {
  it("requires authentication and valid opaque IDs", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await GET(
      new Request(`http://localhost/api/leads/${leadId}/activities`),
      context(),
    )).status).toBe(401);
    expect((await GET(
      new Request("http://localhost/api/leads/not-an-id/activities"),
      context("not-an-id"),
    )).status).toBe(400);
    expect(mocks.getPage).not.toHaveBeenCalled();
  });

  it("loads only the authenticated owner's lead and cursor page", async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/leads/${leadId}/activities?cursor=${cursor}`,
      ),
      context(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getPage).toHaveBeenCalledWith({
      ownerId: "owner-a",
      leadId,
      cursor,
    });
  });

  it("accepts legacy opaque activity IDs as pagination cursors", async () => {
    const legacyCursor = `legacy-follow-up-activity-${leadId}`;
    const response = await GET(
      new Request(
        `http://localhost/api/leads/${leadId}/activities?cursor=${legacyCursor}`,
      ),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.getPage).toHaveBeenCalledWith({
      ownerId: "owner-a",
      leadId,
      cursor: legacyCursor,
    });
  });

  it("returns primitive display items for the pagination island", async () => {
    mocks.getPage.mockResolvedValueOnce({
      items: [
        {
          id: "activity-a",
          type: "TASK_COMPLETED",
          actorType: "USER",
          source: "TASK",
          title: "Task completed",
          description: "Proposal sent",
          metadata: { internal: "not returned" },
          occurredAt: new Date("2026-07-27T12:00:00.000Z"),
          lead: { id: leadId, name: "Acme" },
          conversation: null,
          task: { id: "task-a", title: "Send proposal" },
        },
      ],
      nextCursor: null,
    });
    const response = await GET(
      new Request(
        `http://localhost/api/leads/${leadId}/activities?cursor=${cursor}&now=2026-07-27T12%3A05%3A00.000Z&timeZone=UTC`,
      ),
      context(),
    );

    await expect(response.json()).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "activity-a",
          title: "Task completed",
          occurredAt: "2026-07-27T12:00:00.000Z",
          relativeTime: "5 minutes ago",
          related: {
            kind: "link",
            href: "/tasks/task-a/edit",
            label: "Open task",
          },
        }),
      ],
      nextCursor: null,
    });
  });

  it("rejects invalid render clocks and time zones", async () => {
    expect(
      (
        await GET(
          new Request(
            `http://localhost/api/leads/${leadId}/activities?now=not-a-date`,
          ),
          context(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          new Request(
            `http://localhost/api/leads/${leadId}/activities?timeZone=Not%2FAZone`,
          ),
          context(),
        )
      ).status,
    ).toBe(400);
    expect(mocks.getPage).not.toHaveBeenCalled();
  });

  it("does not reveal another owner's activity and bounds failures", async () => {
    mocks.getPage.mockResolvedValueOnce(null);
    expect((await GET(
      new Request(`http://localhost/api/leads/${leadId}/activities`),
      context(),
    )).status).toBe(404);

    mocks.getPage.mockRejectedValueOnce(new Error("private database detail"));
    const failure = await GET(
      new Request(`http://localhost/api/leads/${leadId}/activities`),
      context(),
    );
    expect(failure.status).toBe(500);
    await expect(failure.json()).resolves.toEqual({
      error: "Activity history is temporarily unavailable.",
    });
    expect(mocks.reportError).toHaveBeenCalled();
  });
});
