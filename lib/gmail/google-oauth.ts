import "server-only";

import { google } from "googleapis";
import { serverEnv } from "@/lib/env";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function validatedGmailRedirectUri(value: string): string {
  const redirect = new URL(value);
  if (
    !["http:", "https:"].includes(redirect.protocol) ||
    redirect.pathname !== "/api/gmail/callback" ||
    redirect.search ||
    redirect.hash
  ) {
    throw new Error(
      "GOOGLE_GMAIL_REDIRECT_URI must use the dedicated /api/gmail/callback route.",
    );
  }
  return redirect.toString();
}

export function googleOAuthClient() {
  if (!serverEnv.GOOGLE_CLIENT_ID || !serverEnv.GOOGLE_CLIENT_SECRET || !serverEnv.GOOGLE_GMAIL_REDIRECT_URI) {
    throw new Error("Google Gmail OAuth is not configured.");
  }
  return new google.auth.OAuth2(
    serverEnv.GOOGLE_CLIENT_ID,
    serverEnv.GOOGLE_CLIENT_SECRET,
    validatedGmailRedirectUri(serverEnv.GOOGLE_GMAIL_REDIRECT_URI),
  );
}
