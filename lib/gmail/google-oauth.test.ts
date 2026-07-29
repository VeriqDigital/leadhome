import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: {},
}));

import { validatedGmailRedirectUri } from "./google-oauth";

describe("Google OAuth flow separation", () => {
  it("accepts dedicated Gmail callbacks for local and production origins", () => {
    expect(
      validatedGmailRedirectUri(
        "http://localhost:3000/api/gmail/callback",
      ),
    ).toBe("http://localhost:3000/api/gmail/callback");
    expect(
      validatedGmailRedirectUri(
        "https://leadhome.example/api/gmail/callback",
      ),
    ).toBe("https://leadhome.example/api/gmail/callback");
  });

  it("rejects the Auth.js callback and callback URLs with extra data", () => {
    expect(() =>
      validatedGmailRedirectUri(
        "https://leadhome.example/api/auth/callback/google",
      ),
    ).toThrow("/api/gmail/callback");
    expect(() =>
      validatedGmailRedirectUri(
        "https://leadhome.example/api/gmail/callback?code=unsafe",
      ),
    ).toThrow("/api/gmail/callback");
  });

  it("leaves the Auth.js Google sign-in provider and its checks intact", () => {
    const authSource = readFileSync("auth.ts", "utf8");

    expect(authSource).toContain('Google({');
    expect(authSource).toContain('scope: "openid email profile"');
    expect(authSource).not.toMatch(/checks\s*:/);
    expect(authSource).not.toMatch(/pkce\s*:\s*false/i);
  });

  it("leaves Account Security Google Link and Unlink on Auth.js", () => {
    const settingsSource = readFileSync("app/settings/page.tsx", "utf8");
    const actionsSource = readFileSync("app/actions/auth-actions.ts", "utf8");

    expect(settingsSource).toContain(
      "action={hasGoogle ? unlinkGoogleAction : linkGoogleAction}",
    );
    expect(settingsSource).toContain('"Unlink Google"');
    expect(settingsSource).toContain('"Link Google sign-in"');
    expect(actionsSource).toMatch(
      /export async function linkGoogleAction\(\)[\s\S]*?signIn\("google"/,
    );
    expect(actionsSource).toMatch(
      /export async function unlinkGoogleAction\(\)[\s\S]*?prisma\.account\.deleteMany/,
    );
  });
});
