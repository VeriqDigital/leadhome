# LeadHome

LeadHome is an owner-scoped CRM for small businesses. It brings leads, Gmail
conversations, website submissions, pipeline stages, tasks, follow-ups,
activity history, and optional AI conversation analysis into one application.

The project is currently a **private alpha candidate**. It is designed for one
owner per account; teams, workspaces, roles, billing, and shared ownership are
not implemented.

## What LeadHome includes

- Lead creation, editing, deletion, search, filtering, pagination, and
  server-side sorting.
- A pipeline board with stage totals, value totals, drag-and-drop movement,
  keyboard controls, and optimistic rollback.
- Tasks and follow-ups with due dates, priorities, statuses, related leads or
  conversations, sorting, filtering, and derived next-follow-up dates.
- A read-only Gmail Inbox with secure OAuth, durable background sync,
  conversation review, classifications, lifecycle controls, and lead
  attachment.
- Deterministic Smart Lead Matching with conservative automatic attachment,
  review-only suggestions, persistent dismissals, manual-detach protection,
  and owner-scoped recovery.
- Automatic Company Detection with conservative owner-scoped domain
  associations, review-only AI/domain suggestions, persistent dismissals, and
  compare-and-set protection for manual lead data.
- Server-to-server website-form ingestion with source tokens, rate limiting,
  validation, and idempotency.
- A unified, immutable activity timeline shared by lead, message, task,
  pipeline, import, and AI events.
- Opt-in Conversation Intelligence using OpenAI Structured Outputs. Analysis
  suggests next actions but never changes CRM data automatically.
- A PostgreSQL-backed durable job queue for Gmail synchronization and
  conversation analysis.
- Credentials authentication and Google sign-in through Auth.js.
- Responsive light and dark themes.

LeadHome currently imports Gmail only. It does not send or modify email, and
Outlook, SMS, WhatsApp, and social-message adapters are not implemented.

## Technology

| Area | Implementation |
| --- | --- |
| Application | Next.js 16.2.11 App Router, React 19.2.4, TypeScript 5 |
| Runtime | Node.js 24.18.0 locally; bounded to Node 24.x |
| Database | PostgreSQL and Prisma 6.19.3 |
| Authentication | Auth.js 5 beta, JWT sessions, Prisma adapter, bcrypt |
| Validation | Zod 4 |
| Styling | Tailwind CSS 4, repository-local components, Lucide icons |
| Background work | PostgreSQL `Job` queue and protected runner routes |
| AI | OpenAI Node SDK, Responses API, Structured Outputs |
| Tests | Vitest, structural migration tests, focused Selenium checks |
| Hosting | Vercel with a scheduled queue-draining route |

Pages are React Server Components by default. Client components are limited to
interactions that need local state, pending UI, polling, drag/touch behavior,
clipboard access, or incremental pagination.

## Prerequisites

- [Node.js 24.18.0](https://nodejs.org/) (the version in `.node-version`)
- npm
- PostgreSQL
- A Google Cloud OAuth web client if using Google sign-in or Gmail
- An OpenAI API key and supported model only if enabling Conversation
  Intelligence

Using another Node 24.x release is supported by `package.json`, but the pinned
version is the reference local and production-compatible runtime.

## Quick start

1. Install the pinned Node version using your preferred version manager.
2. Copy `.env.example` to `.env.local`.
3. Set `DATABASE_URL` and generate a strong `AUTH_SECRET`.
4. Install dependencies:

   ```bash
   npm install
   ```

5. Apply all existing migrations and generate the Prisma client:

   ```bash
   npm run db:migrate:deploy
   npm run db:generate
   ```

6. Start LeadHome:

   ```bash
   npm run dev
   ```

7. Open [http://localhost:3000](http://localhost:3000), register an account,
   and sign in.

For features that use background work, keep the app running and start a
second terminal:

```bash
npm run jobs:worker
```

The `jobs:work` command is an alias for the same polling worker. Use
`npm run jobs:once` to process one bounded batch and exit.

### Windows Prisma note

A running Next.js process can lock Prisma's query-engine DLL. If
`npm run db:generate` reports `EPERM`, stop the development server, rerun the
command, and then restart the server.

## Environment variables

Start from [`.env.example`](./.env.example). Configuration is server-only; the
application does not require any `NEXT_PUBLIC_*` variables.

### Core application

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection used by Prisma. |
| `AUTH_SECRET` | Yes | High-entropy Auth.js signing/encryption secret. |
| `INBOUND_RATE_LIMIT_PER_MINUTE` | No | Accepted website submissions per source/IP in a 60-second window; defaults to `20`. |

Generate secrets outside source control. For example:

```bash
openssl rand -base64 32
```

### Google sign-in and Gmail

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | For Google features | OAuth web-client ID shared by the two separate Google grants. |
| `GOOGLE_CLIENT_SECRET` | For Google features | OAuth web-client secret. |
| `GOOGLE_GMAIL_REDIRECT_URI` | For Gmail | Exact custom Gmail callback, such as `http://localhost:3000/api/gmail/callback`. |
| `TOKEN_ENCRYPTION_KEY` | For Gmail | High-entropy key of at least 32 characters used to encrypt stored Gmail tokens. |
| `GMAIL_SYNC_THREAD_LIMIT` | No | Threads considered per manual sync; defaults to `50` and is bounded to `1`–`100`. |

Google sign-in and Gmail connection use the same OAuth client but remain
separate flows:

- Google sign-in returns to `/api/auth/callback/google` and requests identity
  scopes.
- Gmail connection starts at `/api/gmail/connect`, returns to
  `/api/gmail/callback`, and requests Gmail read-only access.

Never point `GOOGLE_GMAIL_REDIRECT_URI` at the Auth.js callback. See
[Google sign-in and Gmail setup](docs/google-gmail-setup.md) for the complete
Google Cloud checklist and production redirect configuration.

Changing `TOKEN_ENCRYPTION_KEY` makes existing stored credentials unreadable
unless they are migrated; users must otherwise reconnect Gmail.

### Background jobs

| Variable | Required | Purpose |
| --- | --- | --- |
| `JOB_RUNNER_SECRET` | Yes for the local/remote worker route | A server-only secret of at least 40 characters for `POST /api/internal/jobs/run`. |
| `CRON_SECRET` | Production | Vercel Cron credential; use at least 32 random bytes. |
| `JOB_MAX_ATTEMPTS` | No | Maximum attempts for retryable jobs; defaults to `3`. |
| `JOB_STALE_AFTER_SECONDS` | No | Age after which an abandoned running lease can be recovered; defaults to `900`. |
| `JOBS_PER_RUN` | No | Jobs claimed in one internal-runner invocation; defaults to `3`. |
| `JOB_RUN_TIME_BUDGET_MS` | No | Internal-runner execution budget; defaults to `45000`. |
| `JOB_RUNNER_URL` | Local worker only | Runner URL; defaults to `http://localhost:3000/api/internal/jobs/run`. |
| `JOB_WORKER_POLL_INTERVAL_MS` | No | Local polling interval; defaults to `5000` ms. |

Remote `JOB_RUNNER_URL` values must use HTTPS and must not contain credentials
or query parameters. The worker sends `JOB_RUNNER_SECRET` separately.

### Conversation Intelligence

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | For AI analysis | Server-only OpenAI API key. |
| `OPENAI_CONVERSATION_ANALYSIS_MODEL` | For AI analysis | Explicit model used for structured conversation analysis. |
| `AI_ANALYSIS_MAX_INPUT_CHARS` | No | Bounded maximum analysis input; defaults to `60000`. |
| `AI_ANALYSIS_REQUEST_TIMEOUT_MS` | No | Provider request timeout; defaults to `45000`. |
| `AI_ANALYSIS_VERSION` | No | Version marker included in analysis identity; defaults to `conversation-v1`. |
| `RUN_OPENAI_SMOKE_TEST` | No | Set to `true` only for an intentional real-provider smoke test using synthetic content. |

Conversation Intelligence remains unavailable until both the API key and model
are configured, and each user must explicitly opt in from Settings.

### Browser acceptance checks

`BROWSER_TEST_BASE_URL`, `LEADHOME_URL`, and `LEADHOME_SOURCE_TOKEN` are
test/automation inputs rather than normal application configuration. See the
browser script itself before running it against anything other than disposable
local test data.

## Database and migrations

The Prisma schema is in [`prisma/schema.prisma`](prisma/schema.prisma), and
additive migrations live in `prisma/migrations/`.

```bash
npm run db:validate          # validate the schema
npm run db:generate          # generate Prisma Client
npm run db:migrate:deploy    # apply committed migrations
```

Production must run `npm run db:migrate:deploy` before serving application
code that depends on a new migration. The build and post-install scripts
generate Prisma Client, but they do not replace migration deployment.

Never edit a migration that has already been applied. Add a new migration for
every later schema or deterministic data change.

## Google OAuth and Gmail synchronization

In Google Cloud:

1. Enable the Gmail API.
2. Configure the OAuth consent screen and add test users while the app remains
   in Testing.
3. Create a **Web application** OAuth client.
4. Register these local redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `http://localhost:3000/api/gmail/callback`
5. Register equivalent HTTPS redirects for the production origin.
6. Populate the Google, Auth.js, and token-encryption variables in each
   environment.

Gmail Connect and Reconnect are normal server-rendered HTML anchors. They do
not use Next.js prefetching or depend on client-side hydration. The dedicated
flow preserves one-use state validation, PKCE, offline access, consent
behavior, encrypted token persistence, and duplicate-initiation protection.

Manual synchronization enqueues a `GMAIL_SYNC` job. The worker imports recent
Inbox threads using read-only Gmail access, normalizes provider data, and
performs idempotent conversation/message writes. Imports preserve user-owned
classification and attachment state, maintain `lastMessageAt` monotonically,
and never move conversation activity backwards when older messages arrive.

## Smart Lead Matching

Lead matching is deterministic and owner-scoped:

- One unique exact normalized external participant email may auto-attach.
- Duplicate exact emails, exact normalized participant names, and durable
  website-submission identity produce review-only suggestions.
- Connected-mailbox identities and outbound-only messages do not auto-match.
- Fuzzy names, company/domain inference, body extraction, and AI do not attach
  leads.
- Manual attachment always wins.
- Manual detach blocks automatic reattachment until the owner explicitly
  chooses **Allow matching again**.
- Candidate dismissal is persistent for the current evidence fingerprint and
  does not suppress unrelated candidates.
- **Recheck matches** always uses the same centralized matching service.

Automatic matching does not spread an attachment to other existing
conversations merely because one conversation was manually attached.

## Automatic Company Detection

After a conversation is attached, one centralized database-only service may
fill a blank `Lead.company` when a credible external business domain maps to
exactly one normalized company among that owner's other leads. It never
overwrites an existing or concurrently edited company, and ambiguous,
conflicting, public-mailbox, disposable, relay, malformed, connected-mailbox,
outbound-only, and unrelated-recipient evidence fails closed.

Structured Conversation Intelligence company evidence and a name formatted
from a business domain are suggestion-only. The Inbox owner must explicitly
apply or dismiss them; dismissals persist for the current evidence fingerprint,
and **Recheck company** reuses the same owner-scoped detector. Only a real
company write creates the existing `COMPANY_CHANGED` activity.

Interactive attachment and recheck paths evaluate the bounded detector
immediately so the server-rendered Inbox can return canonical state. A Gmail
import that automatically attaches a lead instead enqueues one idempotent
`COMPANY_DETECTION` job; this keeps nonessential company work out of the Gmail
import path while reusing the same detector.

## Background-job operation

LeadHome uses one generic PostgreSQL queue for `GMAIL_SYNC`,
`CONVERSATION_ANALYSIS`, and import-triggered `COMPANY_DETECTION`.

```text
User action
    -> enqueue idempotent Job
    -> protected runner claims with a lease
    -> typed handler reports progress
    -> complete, retry, fail, or cancel
    -> owner-scoped UI polling shows safe status
```

The queue provides atomic claims, `FOR UPDATE SKIP LOCKED`, lease ownership,
heartbeats, lease-fenced writes, bounded retries with jitter, cancellation,
stale recovery, safe error storage, and active-job idempotency.

### Local

Run the web application and poller in separate terminals:

```bash
npm run dev
npm run jobs:worker
```

The worker calls the machine-authenticated
`POST /api/internal/jobs/run` endpoint. Both processes must use the same
`JOB_RUNNER_SECRET`.

### Production

[`vercel.json`](vercel.json) configures:

```text
GET /api/cron/jobs
0 10 * * *
```

That is once daily at 10:00 UTC, compatible with the current Vercel Hobby
schedule. The route validates Vercel's `CRON_SECRET` authorization and invokes
the same bounded runner. Vercel's dashboard **Run** control can trigger it
manually.

Important: Cron drains jobs that have already been queued. It does **not**
automatically enqueue periodic Gmail synchronization. Once-per-minute
automatic draining is a future hosting-plan/configuration change.

See [Background jobs](docs/background-jobs.md) for lifecycle details,
production limits, deployment checks, safe observability, and manual testing.

## Website-form ingestion

`POST /api/inbound/forms` accepts authenticated server-to-server lead
submissions. A website source has a high-entropy token that is displayed only
once; LeadHome stores only its hash.

The endpoint derives ownership from the stored source, rejects browser-origin
requests, enforces body and field bounds, validates with Zod, rate-limits by
source and IP, and supports source-scoped idempotency keys.

Do not expose source tokens in browser JavaScript. Submit from a trusted
website backend. Payload examples, response semantics, rotation, CORS
behavior, and retry guidance are in
[Website form ingestion](docs/inbound-forms.md).

## Conversation Intelligence

Conversation Intelligence is opt-in and background-only. The application:

1. Creates a bounded, plain-text conversation input.
2. Enqueues an idempotent `CONVERSATION_ANALYSIS` job.
3. Calls the configured OpenAI model through the Responses API.
4. Validates strict structured output.
5. Persists one canonical owner/conversation analysis.
6. Displays summaries, signals, risks, and suggested next actions.

AI output never auto-attaches a lead, automatically edits CRM fields, changes
a stage, or creates a task. Creating a task from a suggestion opens an editable
prefilled form and still requires explicit submission. Qualifying structured
company evidence can be reviewed in the Inbox, but applying it is a separate
explicit owner action.

See [Conversation Intelligence](docs/conversation-intelligence.md) for data
bounds, safety rules, configuration, lifecycle, and testing.

## Security and data boundaries

- `User.id` is the tenant boundary. Domain reads, writes, relations, jobs, and
  cursors must remain owner-scoped.
- Credentials passwords are hashed with bcrypt; sessions are JWT-backed.
- Google profiles are accepted only when Google marks their email verified.
- Gmail OAuth state is short-lived, one-use, and stored as a hash.
- Gmail access and refresh tokens are encrypted with AES-256-GCM.
- Gmail uses read-only scope; no send, compose, draft, or modify permission is
  requested.
- Website source secrets and OAuth state tokens are stored only as hashes.
- Imported provider identifiers and database uniqueness make retries
  idempotent.
- Job results and errors are bounded and must not contain tokens, message
  bodies, OAuth codes, cookies, secrets, or complete authorization URLs.
- AI input/output is bounded, structured, and treated as untrusted content.
- Provider-owned imports must not overwrite user-owned CRM decisions.

Do not commit `.env`, `.env.local`, provider credentials, database URLs,
tokens, production logs containing customer data, or generated secrets.

## Application routes

| Route | Purpose |
| --- | --- |
| `/` | Dashboard metrics, tasks, recent leads, and activity |
| `/leads` | Searchable and sortable lead list |
| `/leads/new` | Lead creation |
| `/leads/[id]` | Lead editing, linked work, and activity history |
| `/inbox` | Gmail conversations, matching, review, and analysis |
| `/pipeline` | Pipeline board and stage/value summaries |
| `/tasks` | Searchable, filterable, sortable task list |
| `/tasks/new` | Task creation |
| `/settings` | Account, Google, Gmail, AI, and website-source settings |
| `/login`, `/register` | Authentication |

Important machine/API endpoints include:

- `/api/auth/[...nextauth]` — Auth.js
- `GET /api/gmail/connect` — custom Gmail authorization entry point
- `GET /api/gmail/callback` — custom Gmail token callback
- `POST /api/inbound/forms` — website ingestion
- `POST /api/internal/jobs/run` — protected worker runner
- `GET /api/cron/jobs` — protected Vercel Cron runner
- `GET /api/jobs/status` — owner-scoped Gmail job status
- `GET /api/jobs/conversation-analysis/status` — owner-scoped analysis status
- `GET /api/leads/[id]/activities` — owner-scoped activity pagination

## Repository layout

```text
app/                 App Router pages, route handlers, server actions, and UI
lib/                 Owner-scoped domain services and queries
lib/ai/              Conversation-analysis preparation and provider boundary
lib/gmail/           OAuth, token encryption, Gmail client, and provider code
lib/jobs/            Queue, runner, handlers, leases, and status services
prisma/              Schema, additive migrations, and migration regressions
scripts/             Local job worker and focused browser acceptance script
docs/                Detailed subsystem and project-state documentation
test/                Test replacement for the server-only package
public/              Static assets
```

## Testing and validation

Run the complete project validation:

```bash
npm run validate
```

That command runs Prisma validation, ESLint, TypeScript, and the full Vitest
suite. Individual checks are:

```bash
npm run db:validate
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

The production build runs Prisma generation before `next build`. Normal tests
mock external providers and database clients. Real OpenAI testing is
deliberately opt-in through `RUN_OPENAI_SMOKE_TEST=true` and must use synthetic
content only.

Focused lead-detail browser regressions are available when the required
browser and local test setup are installed:

```bash
npm run test:browser:firefox
npm run test:browser:firefox:normal
npm run test:browser:chrome
```

These scripts are narrow acceptance checks, not a comprehensive browser or
real-PostgreSQL end-to-end suite.

## Vercel deployment checklist

1. Use Node 24.x; the repository pins 24.18.0 locally.
2. Provision PostgreSQL and set the production `DATABASE_URL`.
3. Configure all required server-only environment variables in the correct
   Vercel environments.
4. Register the exact production Google redirect URIs.
5. Set a production `CRON_SECRET` and matching `JOB_RUNNER_SECRET`.
6. Apply committed migrations:

   ```bash
   npm run db:migrate:deploy
   ```

7. Run `npm run validate` and `npm run build`.
8. Deploy and verify authentication, Gmail connection, one queued job, Cron
   authorization, job completion, and owner-scoped UI status.
9. Monitor Cron executions and queue growth. A successful HTTP response can
   still report a job that was scheduled for retry, so inspect the safe job
   outcome rather than status code alone.

Google's public consent and sensitive/restricted-scope verification must be
completed before broader Gmail release. The repository does not claim that
public Google verification is complete.

## Detailed documentation

- [Project state](docs/PROJECT_STATE.md) — current implementation snapshot,
  architectural decisions, limitations, readiness, and roadmap.
- [Google sign-in and Gmail setup](docs/google-gmail-setup.md) — callbacks,
  scopes, consent, connection behavior, and sync operations.
- [Background jobs](docs/background-jobs.md) — queue lifecycle, leases,
  retries, security, production operation, and observability.
- [Production Inbox](docs/inbox.md) — conversation queries, controls,
  ordering, and user workflows.
- [Messaging import architecture](docs/messaging-import.md) — provider
  normalization, idempotency, timestamps, and matching.
- [Conversation Intelligence](docs/conversation-intelligence.md) — AI design,
  safety, configuration, lifecycle, and verification.
- [Website form ingestion](docs/inbound-forms.md) — source tokens, request
  format, limits, CORS, idempotency, and examples.
- [Tasks and follow-ups](docs/tasks.md) — task lifecycle and derived follow-up
  behavior.
- [Pipeline board](docs/pipeline.md) — pipeline query and interaction model.
- [Unified activity timeline](docs/lead-activity-timeline.md) — activity
  recording, ordering, migration behavior, and deletion semantics.
- [Phase 2 progress](docs/PHASE2_PROGRESS.md) — milestone-level progress.

## Known limitations

- The product is single-owner; there are no teams, roles, invitations, or
  shared workspaces.
- Gmail is the only production messaging provider and is read-only.
- Production Cron currently drains once daily and does not schedule recurring
  Gmail syncs.
- There is no MFA, password reset, billing, notification center, or automation
  rules engine.
- Smart matching intentionally avoids fuzzy or autonomous matching.
- AI suggestions require human action; only the reviewed company-suggestion
  flow can update a CRM field.
- OAuth state has no documented retention cleanup job.
- Date grouping uses runtime/browser local time; users have no stored timezone.
- Browser and real-database end-to-end coverage is focused rather than
  comprehensive.
- Production readiness still requires stronger queue monitoring/alerting,
  broader security/account recovery, Google public-app review, and broader
  environment-specific testing.

When extending LeadHome, preserve owner scoping, additive migrations,
idempotent imports/jobs, monotonic message timestamps, centralized matching,
explicit confirmation for AI-suggested changes, and the separation between
provider-owned data and user-owned CRM decisions.
