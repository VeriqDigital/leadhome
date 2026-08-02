import { afterEach, describe, expect, it, vi } from "vitest";
import { reportOperationalError } from "./server-errors";

describe("safe operational error logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omits contact values, provider data, messages, and stacks", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(
      new Error(
        "tom@example.com +1 515-555-0100 raw provider payload refresh-token",
      ),
      { code: "P2002" },
    );

    reportOperationalError("contact extraction mutation failed", error);

    expect(logged).toHaveBeenCalledWith(
      "[LeadHome] contact extraction mutation failed",
      { name: "Error", code: "P2002" },
    );
    const serializedLog = JSON.stringify(logged.mock.calls);
    expect(serializedLog).not.toContain("tom@example.com");
    expect(serializedLog).not.toContain("515-555-0100");
    expect(serializedLog).not.toContain("provider payload");
    expect(serializedLog).not.toContain("refresh-token");
    expect(serializedLog).not.toContain("stack");
  });
});
