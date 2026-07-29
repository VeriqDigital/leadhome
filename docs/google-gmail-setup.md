# Google sign-in and Gmail setup

LeadHome uses one Google OAuth web client for two separate grants:

- Auth.js sign-in requests only `openid email profile` and returns to
  `/api/auth/callback/google`.
- Connect Gmail requests only
  `https://www.googleapis.com/auth/gmail.readonly` and returns to the exact
  `GOOGLE_GMAIL_REDIRECT_URI`.

The read-only Gmail scope is the narrowest Gmail scope that can list threads
and read the headers and bodies needed by the existing importer. LeadHome does
not request modify, compose, send, drafts, or full-mailbox access.

## Google Cloud

1. Create or select a Google Cloud project and enable the Gmail API.
2. Configure the OAuth consent screen. While the app is in Testing, add every
   developer/test mailbox as a test user.
3. Create a **Web application** OAuth client.
4. Register local redirects:
   `http://localhost:3000/api/auth/callback/google` and
   `http://localhost:3000/api/gmail/callback`.
5. Register the equivalent HTTPS URLs for the production LeadHome origin.
   Add preview origins only deliberately; do not point previews at production
   callbacks.
6. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_GMAIL_REDIRECT_URI`, `AUTH_SECRET`, and a high-entropy
   `TOKEN_ENCRYPTION_KEY` in each environment. Never expose these with a
   `NEXT_PUBLIC_` prefix.

`GOOGLE_GMAIL_REDIRECT_URI` must end in the dedicated
`/api/gmail/callback` route. It must never point to
`/api/auth/callback/google`: that route belongs to Auth.js Google sign-in and
expects Auth.js's own PKCE verifier cookie. Gmail mailbox authorization uses
its separate, state-validated callback and token store.

Connect and reconnect controls deliberately use a full browser navigation
rather than a Next.js `Link`. This prevents production Link prefetch from
starting OAuth during rendering. The control and the server route both reject
rapid duplicate initiation; safe logs record only the event, request
host/path, and accepted/duplicate booleans.

Google may omit a refresh token on repeat authorization. LeadHome preserves an
existing encrypted refresh token. Use **Reconnect**, which requests consent
again, when no token was granted or Google revoked access.

## Synchronization and operations

Manual sync imports at most `GMAIL_SYNC_THREAD_LIMIT` threads (default 50,
maximum 100) matching `newer_than:30d in:inbox -in:spam -in:trash`. The browser
request enqueues an owner-scoped job; the existing worker performs Gmail
requests and imports in the background. Requests are paginated and thread
fetches run five at a time. Without a worker or production scheduler draining
the queue, sync remains safely queued.

Import records one idempotent conversation-import activity for a newly seen
thread. Initial message history is a silent baseline; later new messages on an
attached conversation create body-free activity using the Gmail message
timestamp. Automatic lead attachment is recorded separately. Run
`npx prisma migrate deploy` before deploying the application.

The OAuth consent screen and sensitive/restricted-scope verification process
must be reviewed with Google before public release. This repository does not
claim that production verification is complete.
