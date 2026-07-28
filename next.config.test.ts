import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("Next.js development stability", () => {
  it("keeps the optional React debug channel disabled", () => {
    expect(nextConfig.experimental?.reactDebugChannel).toBe(false);
  });
});
