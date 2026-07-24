import { describe, expect, it } from "vitest";
import { LeadRow } from "@/app/components";

describe("dashboard recent leads", () => {
  it("links the entire recent-lead row to its detail page", () => {
    const element = LeadRow({
      lead: {
        id: "lead-a",
        initials: "JD",
        name: "Jane Doe",
        source: "Website Form",
        time: "1m ago",
        status: "New",
        message: "Hello",
      },
    });
    const link = element.props.children;

    expect(link.type).toBeDefined();
    expect(link.props.href).toBe("/leads/lead-a");
    expect(link.props.className).toContain("focus-visible");
  });
});
