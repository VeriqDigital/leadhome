import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GmailOAuthFeedback } from "./gmail-oauth-feedback";

describe("Gmail OAuth Settings feedback", () => {
  it.each([
    ["already-connected", "already connected to this workspace"],
    ["conflict", "already connected to another workspace"],
    ["refresh", "required offline access"],
    ["invalid", "expired or is invalid"],
    ["provider", "temporarily unavailable"],
    ["configuration", "unexpected configuration problem"],
    ["persistence", "connection could not be saved"],
  ])("renders a safe distinct message for %s", (result, expected) => {
    const markup = renderToStaticMarkup(
      <GmailOAuthFeedback result={result} />,
    );

    expect(markup).toContain(expected);
    expect(markup).not.toContain("token");
    expect(markup).not.toContain("database");
  });

  it("does not reflect unknown query-string values", () => {
    const markup = renderToStaticMarkup(
      <GmailOAuthFeedback result="<script>unsafe</script>" />,
    );

    expect(markup).toBe("");
  });
});
