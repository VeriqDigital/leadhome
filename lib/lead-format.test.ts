import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatDateOnly,
  formatDateTime,
  formatRelativeTime,
  isLeadSource,
  isLeadStatus,
} from "@/lib/lead-format";

describe("lead formatting", () => {
  it("formats values consistently and handles malformed legacy values", () => {
    expect(formatCurrency("2500.50")).toBe("$2,500.5");
    expect(formatCurrency("not-a-number")).toBe("No value");
    expect(formatDateOnly("2026-07-24T23:59:00Z")).toBe("Jul 24, 2026");
    expect(formatDateOnly("legacy")).toBe("No date");
    expect(formatDateTime(new Date("invalid"))).toBe("Unknown time");
    expect(formatRelativeTime(new Date("invalid"))).toBe("Unknown time");
  });

  it("narrows known status and source values", () => {
    expect(isLeadStatus("FOLLOW_UP")).toBe(true);
    expect(isLeadStatus("ARCHIVED")).toBe(false);
    expect(isLeadSource("WEBSITE")).toBe(true);
    expect(isLeadSource(null)).toBe(false);
  });
});
