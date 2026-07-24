import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SaveResultMessage,
  canonicalFormValues,
} from "@/app/leads/lead-form";

describe("lead save result messaging", () => {
  it.each([
    [{ success: true, changed: true, message: "Lead updated." }, "success"],
    [{ success: true, changed: false, message: "No changes to save." }, "neutral"],
    [{ success: false, message: "Unable to save." }, "error"],
  ] as const)("renders the server result with the correct tone", (state, tone) => {
    const html = renderToStaticMarkup(<SaveResultMessage state={state} />);
    expect(html).toContain(state.message);
    expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});

describe("lead form canonical state", () => {
  it("synchronizes status and follow-up independently from canonical results", () => {
    const fields = canonicalFormValues({
      id: "lead-a",
      name: "Jane",
      company: null,
      email: null,
      phone: null,
      source: "MANUAL",
      status: "CONTACTED",
      estimatedValue: null,
      nextFollowUp: "2026-08-12",
      message: null,
      updatedAt: "2026-07-24T12:00:00.000Z",
    });
    expect(fields.status).toBe("CONTACTED");
    expect(fields.nextFollowUp).toBe("2026-08-12");
  });

  it("uses unique fields and explicit guarded submission without form-action reset", () => {
    const source = readFileSync(
      new URL("./lead-form.tsx", import.meta.url),
      "utf8",
    );
    expect(source.match(/name="status"/g)).toHaveLength(1);
    expect(source.match(/name="nextFollowUp"/g)).toHaveLength(1);
    expect(source).not.toContain('type="hidden"');
    expect(source).not.toContain("action={formAction}");
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain("if (pending) return");
    expect(source).toContain("startTransition(() => formAction(data))");
    expect(source).toContain('type="submit"');
  });
});
