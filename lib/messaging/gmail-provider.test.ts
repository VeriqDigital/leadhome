import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/gmail/gmail-client", () => ({
  createGmailClient: vi.fn(),
}));

import { createGmailClient } from "@/lib/gmail/gmail-client";
import {
  GmailProvider,
  GmailRequestDeadlineError,
  boundedGmailThreadLimit,
  gmailRequestTimeoutMs,
} from "./gmail-provider";

const mockedCreateGmailClient = vi.mocked(createGmailClient);

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe("Gmail message identity normalization", () => {
  it("preserves display addresses while using normalized emails for direction and recipients", async () => {
    const getThread = vi.fn().mockResolvedValue({
      data: {
        messages: [{
          id: "message-1",
          internalDate: "1785326400000",
          payload: {
            headers: [
              { name: "From", value: "\"Doe, Jane\" <JANE@example.com>" },
              { name: "Reply-To", value: "\"Jane Replies\" <REPLY@example.com>" },
              { name: "To", value: "\"Lead\" <LEAD@example.com>" },
              { name: "Cc", value: "TEAM@example.com" },
              { name: "Subject", value: "Checking in" },
            ],
          },
        }, {
          id: "message-2",
          internalDate: "1785326460000",
          payload: {
            headers: [
              { name: "From", value: "\"Account Owner\" <OWNER@example.com>" },
              { name: "To", value: "\"Jane Doe\" <JANE@example.com>" },
              { name: "Subject", value: "Re: Checking in" },
            ],
          },
        }],
      },
    });
    mockedCreateGmailClient.mockResolvedValue({
      account: {
        address: "owner@example.com",
      },
      gmail: {
        users: {
          threads: {
            get: getThread,
          },
        },
      },
    } as never);

    const provider = new GmailProvider("account-1", "owner-1");
    const messages = await provider.listMessages("thread-1");

    expect(getThread).toHaveBeenCalledWith(
      { userId: "me", id: "thread-1", format: "full" },
      { timeout: 10_000 },
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      sender: "\"Doe, Jane\" <JANE@example.com>",
      replyTo: "\"Jane Replies\" <REPLY@example.com>",
      direction: "INBOUND",
      recipients: ["lead@example.com", "team@example.com"],
    });
    expect(messages[1]).toMatchObject({
      sender: "\"Account Owner\" <OWNER@example.com>",
      replyTo: null,
      direction: "OUTBOUND",
      recipients: ["jane@example.com"],
    });
  });

  it("uses Gmail's SENT label as canonical outbound evidence for an alias", async () => {
    mockedCreateGmailClient.mockResolvedValue({
      account: { address: "owner@example.com" },
      gmail: {
        users: {
          threads: {
            get: vi.fn().mockResolvedValue({
              data: {
                messages: [{
                  id: "message-alias",
                  internalDate: "1785326460000",
                  labelIds: ["SENT"],
                  payload: { headers: [
                    { name: "From", value: "Alias <sales@example.com>" },
                    { name: "To", value: "lead@example.com" },
                  ] },
                }],
              },
            }),
          },
        },
      },
    } as never);

    const messages = await new GmailProvider("account-1", "owner-1")
      .listMessages("thread-1");
    expect(messages[0]).toMatchObject({
      direction: "OUTBOUND",
      recipients: ["lead@example.com"],
    });
  });

  it("does not normalize a Gmail draft as a sent message", async () => {
    mockedCreateGmailClient.mockResolvedValue({
      account: { address: "owner@example.com" },
      gmail: {
        users: {
          threads: {
            get: vi.fn().mockResolvedValue({
              data: {
                messages: [{
                  id: "draft-a",
                  internalDate: "1785326460000",
                  labelIds: ["DRAFT"],
                  payload: { headers: [
                    { name: "From", value: "owner@example.com" },
                    { name: "To", value: "lead@example.com" },
                  ] },
                }],
              },
            }),
          },
        },
      },
    } as never);

    await expect(
      new GmailProvider("account-1", "owner-1").listMessages("thread-1"),
    ).resolves.toEqual([]);
  });

  it("lists both inbox and sent threads so sent-only contact can import", async () => {
    const list = vi.fn().mockResolvedValue({
      data: { threads: [{ id: "thread-sent" }] },
    });
    mockedCreateGmailClient.mockResolvedValue({
      account: { address: "owner@example.com" },
      gmail: { users: { threads: { list } } },
    } as never);

    await expect(
      new GmailProvider("account-1", "owner-1").listRecentConversations(),
    ).resolves.toEqual([{ providerConversationId: "thread-sent" }]);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "newer_than:30d {in:inbox in:sent} -in:spam -in:trash",
      }),
      { timeout: 10_000 },
    );
  });
});
