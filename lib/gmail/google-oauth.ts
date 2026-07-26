import "server-only";

import { google } from "googleapis";
import { serverEnv } from "@/lib/env";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function googleOAuthClient() {
  if (!serverEnv.GOOGLE_CLIENT_ID || !serverEnv.GOOGLE_CLIENT_SECRET || !serverEnv.GOOGLE_GMAIL_REDIRECT_URI) {
    throw new Error("Google Gmail OAuth is not configured.");
  }
  return new google.auth.OAuth2(
    serverEnv.GOOGLE_CLIENT_ID,
    serverEnv.GOOGLE_CLIENT_SECRET,
    serverEnv.GOOGLE_GMAIL_REDIRECT_URI,
  );
}
