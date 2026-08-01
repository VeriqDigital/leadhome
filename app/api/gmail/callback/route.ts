import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { consumeOAuthState } from "@/lib/gmail/oauth-state";
import { googleOAuthClient } from "@/lib/gmail/google-oauth";
import { encryptToken } from "@/lib/gmail/token-crypto";

const settings = (request: Request, result: string) =>
  NextResponse.redirect(new URL(`/settings?gmail=${result}`, request.url));

type CallbackStage =
  | "session_validation"
  | "request_validation"
  | "provider_authorization"
  | "configuration_validation"
  | "state_validation"
  | "state_consumption"
  | "token_exchange"
  | "refresh_token_validation"
  | "mailbox_profile_lookup"
  | "mailbox_validation"
  | "token_encryption"
  | "database_persistence"
  | "success_redirect"
  | "unexpected_failure";

type CallbackDiagnostic = {
  stateExisted?: boolean;
  refreshTokenPresent?: boolean;
  mailboxRecordExisted?: boolean;
  persistenceSucceeded?: boolean;
  safeErrorClass?: string;
};

function safeErrorClass(error: unknown) {
  if (!(error instanceof Error)) return "UnknownError";
  return /^[A-Za-z0-9_.-]{1,80}$/.test(error.name)
    ? error.name
    : "UnknownError";
}

function logCallback(
  request: Request,
  callbackStage: CallbackStage,
  reasonCode: string,
  diagnostic: CallbackDiagnostic = {},
) {
  const requestUrl = new URL(request.url);
  console.info("[LeadHome] Gmail OAuth", {
    event: "gmail_oauth_callback",
    callbackStage,
    reasonCode,
    requestHost: requestUrl.host,
    requestPath: requestUrl.pathname,
    ...diagnostic,
  });
}

function providerFailure(
  request: Request,
  callbackStage: "token_exchange" | "mailbox_profile_lookup",
  reasonCode: string,
  error: unknown,
) {
  logCallback(request, callbackStage, reasonCode, {
    safeErrorClass: safeErrorClass(error),
  });
  return settings(request, "provider");
}

async function findExistingMailbox(mailboxEmail: string) {
  return prisma.communicationAccount.findFirst({
    where: {
      provider: "GMAIL",
      OR: [
        { providerAccountId: mailboxEmail },
        { address: { equals: mailboxEmail, mode: "insensitive" } },
      ],
    },
    include: { gmailCredential: true },
  });
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      logCallback(request, "session_validation", "session_missing");
      return settings(request, "invalid");
    }
    logCallback(request, "session_validation", "session_valid");

    const params = new URL(request.url).searchParams;
    if (params.get("error")) {
      logCallback(
        request,
        "provider_authorization",
        "authorization_not_completed",
      );
      return settings(request, "denied");
    }
    const state = params.get("state");
    const code = params.get("code");
    if (!state || !code) {
      logCallback(request, "request_validation", "callback_parameters_missing", {
        stateExisted: Boolean(state),
      });
      return settings(request, "invalid");
    }
    logCallback(request, "request_validation", "callback_parameters_present", {
      stateExisted: true,
    });

    let stateResult;
    try {
      stateResult = await consumeOAuthState(state, session.user.id);
    } catch (error) {
      logCallback(request, "state_validation", "state_lookup_failed", {
        safeErrorClass: safeErrorClass(error),
      });
      return settings(request, "persistence");
    }
    if (stateResult.kind === "invalid") {
      logCallback(request, "state_validation", stateResult.reasonCode, {
        stateExisted: stateResult.stateExisted,
      });
      return settings(request, "invalid");
    }
    logCallback(request, "state_validation", "state_valid", {
      stateExisted: true,
    });
    logCallback(request, "state_consumption", "state_consumed", {
      stateExisted: true,
    });

    let oauth: ReturnType<typeof googleOAuthClient>;
    try {
      oauth = googleOAuthClient();
    } catch (error) {
      logCallback(
        request,
        "configuration_validation",
        "oauth_client_configuration_failed",
        { safeErrorClass: safeErrorClass(error) },
      );
      return settings(request, "configuration");
    }

    let tokens: Parameters<typeof oauth.setCredentials>[0];
    try {
      ({ tokens } = await oauth.getToken(code));
    } catch (error) {
      return providerFailure(
        request,
        "token_exchange",
        "token_exchange_failed",
        error,
      );
    }
    logCallback(request, "token_exchange", "token_exchange_succeeded", {
      refreshTokenPresent: Boolean(tokens.refresh_token),
    });
    oauth.setCredentials(tokens);

    let mailboxEmail: string | undefined;
    try {
      const gmail = (await import("googleapis")).google.gmail({
        version: "v1",
        auth: oauth,
      });
      const profile = await gmail.users.getProfile({ userId: "me" });
      mailboxEmail = profile.data.emailAddress?.trim().toLowerCase();
    } catch (error) {
      return providerFailure(
        request,
        "mailbox_profile_lookup",
        "gmail_profile_lookup_failed",
        error,
      );
    }
    if (!mailboxEmail) {
      logCallback(
        request,
        "mailbox_profile_lookup",
        "gmail_profile_email_missing",
      );
      return settings(request, "provider");
    }
    logCallback(
      request,
      "mailbox_profile_lookup",
      "gmail_profile_lookup_succeeded",
    );

    let existing: Awaited<ReturnType<typeof findExistingMailbox>>;
    try {
      existing = await findExistingMailbox(mailboxEmail);
    } catch (error) {
      logCallback(
        request,
        "database_persistence",
        "mailbox_lookup_failed",
        {
          persistenceSucceeded: false,
          safeErrorClass: safeErrorClass(error),
        },
      );
      return settings(request, "persistence");
    }
    if (existing && existing.ownerId !== session.user.id) {
      logCallback(request, "mailbox_validation", "mailbox_owned_elsewhere", {
        mailboxRecordExisted: true,
      });
      return settings(request, "conflict");
    }
    if (existing?.status === "CONNECTED") {
      logCallback(
        request,
        "mailbox_validation",
        "mailbox_already_connected_to_owner",
        { mailboxRecordExisted: true },
      );
      return settings(request, "already-connected");
    }
    logCallback(request, "mailbox_validation", "mailbox_available", {
      mailboxRecordExisted: Boolean(existing),
    });

    const existingRefreshToken =
      existing?.gmailCredential?.encryptedRefreshToken;
    if (!tokens.refresh_token && !existingRefreshToken) {
      logCallback(
        request,
        "refresh_token_validation",
        "offline_refresh_token_missing",
        {
          refreshTokenPresent: false,
          mailboxRecordExisted: Boolean(existing),
        },
      );
      return settings(request, "refresh");
    }
    logCallback(
      request,
      "refresh_token_validation",
      tokens.refresh_token
        ? "new_refresh_token_present"
        : "existing_refresh_token_preserved",
      {
        refreshTokenPresent: Boolean(tokens.refresh_token),
        mailboxRecordExisted: Boolean(existing),
      },
    );

    let encryptedRefreshTokenCandidate: string | undefined;
    let encryptedAccessToken: string | null | undefined;
    try {
      encryptedRefreshTokenCandidate = tokens.refresh_token
        ? encryptToken(tokens.refresh_token)
        : existingRefreshToken;
      encryptedAccessToken = tokens.access_token
        ? encryptToken(tokens.access_token)
        : existing?.gmailCredential?.encryptedAccessToken;
    } catch (error) {
      logCallback(request, "token_encryption", "token_encryption_failed", {
        refreshTokenPresent: Boolean(tokens.refresh_token),
        mailboxRecordExisted: Boolean(existing),
        safeErrorClass: safeErrorClass(error),
      });
      return settings(request, "configuration");
    }
    if (!encryptedRefreshTokenCandidate) {
      logCallback(request, "token_encryption", "encrypted_refresh_missing", {
        mailboxRecordExisted: Boolean(existing),
      });
      return settings(request, "configuration");
    }
    const encryptedRefreshToken = encryptedRefreshTokenCandidate;
    logCallback(request, "token_encryption", "token_encryption_succeeded", {
      refreshTokenPresent: Boolean(tokens.refresh_token),
      mailboxRecordExisted: Boolean(existing),
    });

    try {
      await prisma.$transaction(async (tx) => {
        let accountId: string;
        if (existing) {
          const updated = await tx.communicationAccount.updateMany({
            where: {
              id: existing.id,
              ownerId: session.user.id,
              provider: "GMAIL",
            },
            data: {
              address: mailboxEmail,
              grantedScopes: tokens.scope ?? existing.grantedScopes,
              tokenExpiresAt: tokens.expiry_date
                ? new Date(tokens.expiry_date)
                : null,
              status: "CONNECTED",
              disconnectedAt: null,
              lastSyncError: null,
            },
          });
          if (updated.count !== 1) {
            throw new Error("OwnerScopedMailboxUpdateError");
          }
          accountId = existing.id;
        } else {
          const account = await tx.communicationAccount.create({
            data: {
              ownerId: session.user.id,
              provider: "GMAIL",
              providerAccountId: mailboxEmail,
              displayName: mailboxEmail,
              address: mailboxEmail,
              grantedScopes: tokens.scope,
              tokenExpiresAt: tokens.expiry_date
                ? new Date(tokens.expiry_date)
                : null,
            },
          });
          accountId = account.id;
        }

        await tx.gmailCredential.upsert({
          where: { communicationAccountId: accountId },
          create: {
            communicationAccountId: accountId,
            encryptedRefreshToken,
            encryptedAccessToken: encryptedAccessToken ?? null,
          },
          update: {
            encryptedRefreshToken,
            ...(encryptedAccessToken
              ? { encryptedAccessToken }
              : {}),
          },
        });
      });
    } catch (error) {
      logCallback(
        request,
        "database_persistence",
        "mailbox_persistence_failed",
        {
          mailboxRecordExisted: Boolean(existing),
          persistenceSucceeded: false,
          safeErrorClass: safeErrorClass(error),
        },
      );
      return settings(request, "persistence");
    }
    logCallback(
      request,
      "database_persistence",
      existing ? "mailbox_reconnect_persisted" : "mailbox_connection_persisted",
      {
        mailboxRecordExisted: Boolean(existing),
        persistenceSucceeded: true,
      },
    );
    logCallback(request, "success_redirect", "mailbox_connected", {
      mailboxRecordExisted: Boolean(existing),
      persistenceSucceeded: true,
    });
    return settings(request, "connected");
  } catch (error) {
    logCallback(request, "unexpected_failure", "unexpected_callback_failure", {
      persistenceSucceeded: false,
      safeErrorClass: safeErrorClass(error),
    });
    return settings(request, "unexpected");
  }
}
