import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/gmail/gmail-client", () => ({
  createGmailClient: vi.fn(),
}));

import {
  GmailRequestDeadlineError,
  boundedGmailThreadLimit,
  gmailRequestTimeoutMs,
} from "./gmail-provider";

describe("Gmail provider limits", () => {
  it("bounds per-job thread limits and safely handles malformed configuration", () => {
    expect(boundedGmailThreadLimit(1)).toBe(1);
    expect(boundedGmailThreadLimit("25")).toBe(25);
    expect(boundedGmailThreadLimit(500)).toBe(100);
    expect(boundedGmailThreadLimit("not-a-number")).toBe(50);
    expect(boundedGmailThreadLimit(0)).toBe(50);
  });

  it("caps provider requests and refuses to start one near the job deadline", () => {
    expect(gmailRequestTimeoutMs(undefined, 1_000)).toBe(10_000);
    expect(gmailRequestTimeoutMs(20_000, 1_000)).toBe(10_000);
    expect(gmailRequestTimeoutMs(8_000, 1_000)).toBe(6_000);
    expect(() => gmailRequestTimeoutMs(2_500, 1_000))
      .toThrow(GmailRequestDeadlineError);
  });
});
