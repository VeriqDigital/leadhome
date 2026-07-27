import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { config } from "./proxy";

describe("authentication proxy matcher", () => {
  it("bypasses browser authentication only for the secret-protected worker endpoint", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/api/internal/jobs/run",
      }),
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/api/jobs/status",
      }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "/api/internal/jobs/run-arbitrary",
      }),
    ).toBe(true);
  });
});
