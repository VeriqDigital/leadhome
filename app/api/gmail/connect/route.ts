import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createOAuthState } from "@/lib/gmail/oauth-state";
import { GMAIL_SCOPE, googleOAuthClient } from "@/lib/gmail/google-oauth";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", request.url));
  const state = await createOAuthState(session.user.id);
  const reconnect = new URL(request.url).searchParams.get("reconnect") === "1";
  const url = googleOAuthClient().generateAuthUrl({
    access_type: "offline", include_granted_scopes: true, prompt: reconnect ? "consent" : undefined,
    scope: [GMAIL_SCOPE], state,
  });
  return NextResponse.redirect(url);
}
