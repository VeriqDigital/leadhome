import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { beginOAuthState } from "@/lib/gmail/oauth-state";
import { GMAIL_SCOPE, googleOAuthClient } from "@/lib/gmail/google-oauth";

function logInitiation(
  request: Request,
  accepted: boolean,
  duplicate: boolean,
) {
  const requestUrl = new URL(request.url);
  console.info("[LeadHome] Gmail OAuth", {
    event: "gmail_oauth_initiation",
    requestHost: requestUrl.host,
    requestPath: requestUrl.pathname,
    accepted,
    duplicate,
  });
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    logInitiation(request, false, false);
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let oauth;
  try {
    oauth = googleOAuthClient();
  } catch {
    logInitiation(request, false, false);
    return NextResponse.redirect(
      new URL("/settings?gmail=configuration", request.url),
    );
  }

  const initiation = await beginOAuthState(session.user.id);
  if (initiation.kind === "duplicate") {
    logInitiation(request, false, true);
    return NextResponse.redirect(
      new URL("/settings?gmail=already-starting", request.url),
    );
  }

  const reconnect = new URL(request.url).searchParams.get("reconnect") === "1";
  const url = oauth.generateAuthUrl({
    access_type: "offline", include_granted_scopes: true, prompt: reconnect ? "consent" : undefined,
    scope: [GMAIL_SCOPE], state: initiation.state,
  });
  logInitiation(request, true, false);
  return NextResponse.redirect(url);
}
