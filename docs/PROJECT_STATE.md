# LeadHome Project State

This document is a repository-verified baseline for future development. It
describes the implementation currently present in the working tree. The
Unified Activity Timeline migrations are deployed to the configured database,
and the milestone's Prisma, test, TypeScript, lint, and production-build checks
have passed. Subsequent lead-detail, follow-up-form, development-runtime, and
worker corrections are stabilization work rather than another completed Phase
2 milestone.

## Product Overview

LeadHome is a small-business CRM for collecting leads, reviewing customer
conversations, managing pipeline stages and follow-ups, and turning email and
website activity into organized sales work.

The current product direction is a connected operating surface rather than a
set of unrelated lead records. Leads, Gmail conversations, website
submissions, tasks, AI analysis, pipeline state, and activity history share
owner-scoped relationships. The longer-term goal is to become a central
operating system for customer acquisition while preserving deliberate user
control over CRM-changing actions.

The implemented product is single-owner rather than team/workspace based.
Gmail is the only production messaging integration. Provider enums anticipate
other channels, but those adapters are not implemented.

## Technology Stack

- **Framework and UI:** Next.js 16.2.11 App Router, React 19.2.4, and
  TypeScript 5 in strict mode.
- **Runtime:** Node 24.18.0 is the exact local pin, and `package.json` supports
  the bounded `24.x` major. This matches the linked Vercel project's configured
  Node 24.x runtime. Node 26.5.0 is used only as an additional comparison
  runtime.
- **Database and ORM:** PostgreSQL through Prisma 6.19.3. Prisma migrations are
  additive and live under `prisma/migrations/`.
- **Authentication:** Auth.js/NextAuth 5 beta with the Prisma adapter, JWT
  sessions, credentials login, bcrypt password hashing, and Google sign-in.
- **AI:** OpenAI's Node SDK and the Responses API with Structured Outputs.
  Provider access is isolated behind the conversation-analysis provider and
  the generic background-job worker.
- **Background work:** A PostgreSQL-backed `Job` queue, a protected internal
  runner route, and the local `scripts/jobs-worker.mjs` poller.
- **Styling and components:** Tailwind CSS 4 utility classes, repository-local
  React components, Lucide icons, and CSS-driven light/dark themes. There is no
  external component framework.
- **Validation and testing:** Zod 4, Vitest 3 in a Node environment, static
  React rendering for component tests, ESLint 9 with Next.js Core Web Vitals,
  TypeScript's no-emit checker, and a focused Selenium lead-detail acceptance
  script for installed Firefox and Chrome.
- **External services:** Google OAuth and the Gmail read-only API, OpenAI, and
  PostgreSQL.
- **Hosting assumptions:** The directory is linked to a Vercel project, and
  the build script runs Prisma generation before `next build`. The repository
  and linked project both target Node 24.x. The repository does not install a
  production job schedule; a persistent worker or external scheduler must
  call the protected runner endpoint. A linked Vercel project is evidence of
  intended hosting, not evidence that the current build is deployed.

## Repository Structure

- `app/` contains App Router pages, route handlers, server actions, client
  interaction components, global styles, and route-level UI states.
- `lib/` contains server-side domain services and queries for activities,
  messaging, Gmail, jobs, AI, tasks, leads, and pipeline behavior.
- `prisma/` contains the schema, immutable migration history, and
  migration/schema regression tests.
- `scripts/` contains the local background-job worker, its tests, and the
  focused lead-detail browser acceptance script.
- `docs/` contains subsystem documentation. Detailed references include:
  - [Background jobs](./background-jobs.md)
  - [Conversation Intelligence](./conversation-intelligence.md)
  - [Google and Gmail setup](./google-gmail-setup.md)
  - [Production Inbox](./inbox.md)
  - [Messaging imports](./messaging-import.md)
  - [Website form ingestion](./inbound-forms.md)
  - [Tasks and follow-ups](./tasks.md)
  - [Pipeline board](./pipeline.md)
  - [Unified lead activity](./lead-activity-timeline.md)
- `test/` provides the test replacement for the `server-only` module.
- `public/` contains static assets, while root configuration files define
  Next.js, TypeScript, Tailwind/PostCSS, ESLint, Vitest, Auth.js, and proxy
  behavior.

## Authentication and Tenant Isolation

Auth.js supports credentials and Google sign-in. Credentials are normalized
and validated with Zod; registered passwords are hashed with bcrypt using cost
12. Google sign-in requests profile scopes and rejects profiles that Google
does not mark as email-verified. Auth.js stores provider account records
through Prisma and places the user ID in the JWT/session callbacks.

`proxy.ts` requires a session for application routes, except Auth.js,
server-to-server inbound forms, the separately authenticated internal job
runner, and static assets. Server-rendered pages normally call
`requireUser()`, which redirects unauthenticated users to `/login`. API routes
and server actions additionally authenticate explicitly.

The `User` row is the current tenant boundary. Domain models use either
`userId` or `ownerId`; both refer to the authenticated `User.id`. Queries and
mutations generally include that owner key, often with `findFirst`,
`updateMany`, or `deleteMany` so an arbitrary ID alone cannot cross tenants.
Shared services validate linked leads, conversations, messages, tasks, Gmail
accounts, jobs, and activities against the same owner.

Important authorization helpers and boundaries include:

- `lib/auth-user.ts` for authenticated page/action access.
- `lib/activity-service.ts` for validating every linked activity entity.
- Owner-scoped messaging, task, pipeline, job, and AI services under `lib/`.
- Source-token ownership derived from the stored website source rather than
  caller-supplied user data.
- A separate high-entropy bearer secret for `POST /api/internal/jobs/run`.

Known limitations are that there is no workspace, role, invitation, or shared
ownership model; all isolation is per user. Ownership naming is not uniform
across older models. Authorization is well covered by service tests, but the
repository has no browser end-to-end suite that exercises every route against
a real multi-user database.

## Database Architecture

- **Users and authentication:** `User` owns all tenant data and stores the
  Conversation Intelligence opt-in. Auth.js `Account` rows represent login
  providers. Sessions use JWTs, so there is no Prisma `Session` model.
- **Leads:** `Lead` stores identity, contact information, source, stage,
  notes, estimated value, and a query-friendly next-follow-up summary. It owns
  conversations, tasks, inbound submissions, and optional activity links.
- **Website sources:** `InboundSource` stores a one-way token hash and active
  state. `InboundRateLimit` tracks bounded source/IP windows.
  `InboundSubmission` gives a source-scoped idempotency key a durable lead
  result.
- **Messaging:** `CommunicationAccount` represents an owner/provider mailbox.
  `GmailCredential` is a one-to-one encrypted credential record.
  `Conversation` is unique within an account and keeps user-owned attachment,
  classification, review, manual-detach, and lifecycle state.
  `Message` is unique by account/provider message ID and retains normalized
  message content and timestamps.
- **Tasks:** `Task` is the canonical work/reminder record. Lead and
  conversation links are optional and use `SetNull` deletion behavior.
  Status, priority, type, due time, and completion time support follow-up
  workflows.
- **Unified activity:** The existing `LeadActivity` model is extended rather
  than replaced. It is owner-scoped and may link to a lead, conversation,
  message, and task. Stable enum fields describe event type, actor type, and
  source. `occurredAt` separates business time from insertion time, metadata
  is structured JSON, and an owner-scoped idempotency key prevents duplicate
  imported/background events. Related entity deletion sets links to null so
  history remains; owner deletion cascades. The recording service requires at
  least a lead, conversation, or task and validates all relationships.
- **Background jobs:** `Job` stores typed payload/result/progress JSON,
  scheduling, attempts, lease ownership, heartbeat and lifecycle timestamps,
  safe error fields, and an active idempotency key.
- **Conversation analysis:** `ConversationAnalysis` stores one canonical,
  owner-scoped analysis per conversation, including structured output,
  content/version hashes, model/token metadata, truncation state, and safe
  lifecycle errors.
- **OAuth state:** `OAuthState` stores a hash of a short-lived, one-use Gmail
  authorization state token. It is owner-associated by value but does not have
  a Prisma relation to `User`.

Important invariants include:

- Conversations and messages are deduplicated by provider identifiers.
- `Conversation.lastMessageAt` is maintained monotonically and Inbox sorting
  uses explicit null-last ordering.
- A lead's `nextFollowUpDate` equals the earliest due date of its open
  `FOLLOW_UP` tasks.
- One owner/type/idempotency key identifies an active job; terminal services
  release the key when a new run should be allowed.
- One owner/conversation has one canonical Conversation Intelligence record.
- Activity indexes support lead, conversation, task, owner, type, and
  chronological queries. Equal activity timestamps use ID as the stable
  tie-breaker.

Migration `20260727230000_unified_activity_timeline` preserves existing
activity rows, uses their original `createdAt` as the best available
`occurredAt`, replaces message-event occurrence times with `Message.receivedAt`
where possible, and restores task relations from legacy metadata where a
matching owned task still exists. Follow-up migration
`20260727231500_correct_unified_activity_provenance` preserves the already
applied migration and corrects legacy Gmail-message and automatic-link
provenance where surviving canonical data is sufficient. Neither migration
invents events for older leads that never had activity records.

## Background Job System

LeadHome uses one generic PostgreSQL queue for `GMAIL_SYNC` and
`CONVERSATION_ANALYSIS`. See [background-jobs.md](./background-jobs.md) for the
full lifecycle.

Server actions enqueue typed jobs and reuse an existing active job through
owner/type/idempotency uniqueness. Browser requests do not perform Gmail or
OpenAI work. The local polling worker calls `POST /api/internal/jobs/run`;
Vercel Cron calls `GET /api/cron/jobs` once per minute in production. Both
machine-authenticated routes invoke `lib/jobs/runner.ts`, which recovers stale
work, atomically claims eligible rows with `FOR UPDATE SKIP LOCKED`, assigns a
unique lease owner, and dispatches by `JobType`.

The runner and handlers provide:

- Bounded jobs per invocation and a total execution deadline.
- Heartbeats and lease-fenced writes so stale workers cannot finalize newer
  attempts.
- Persisted progress suitable for authenticated polling.
- Bounded retry scheduling with jitter and retryable/non-retryable error
  classification.
- Cooperative cancellation and stale-lease recovery.
- Active-job idempotency plus importer- or analysis-level idempotency.
- Safe, bounded errors and results that exclude credentials and message
  bodies.
- Retention cleanup for terminal jobs while active jobs are preserved.
- Explicit stop reasons for queue empty, maximum jobs, time budget, or abort.

Gmail jobs call the existing provider adapter and provider-agnostic importer.
Conversation-analysis jobs prepare bounded content, invoke the configured
OpenAI provider, validate structured output, and lease-fence canonical
analysis persistence. `vercel.json` installs the production queue drainer at
`* * * * *` UTC. It runs sequentially with a 10-job maximum, a 240-second
internal budget, and a 300-second Node.js Function limit. Vercel Pro is
required because Hobby supports only daily cron execution.

The local polling worker removes each delay's shutdown-signal abort listener
whether the timer completes normally or the process is stopping. This prevents
listeners from accumulating across polling cycles and eliminates the observed
`MaxListenersExceededWarning`; a 12-cycle regression verifies that the listener
count returns to zero after every completed delay.

## Current Features

### Dashboard

Authenticated users see current lead metrics, recent leads, pipeline stage
counts, overdue/due-today/upcoming tasks, and a compact Recent Activity list.
Recent Activity uses a bounded meaningful-type allowlist and links to the most
useful surviving lead, conversation, or task. It is chronological, not an
attention score.

### Leads

Users can create, view, edit, and delete owned leads. The Leads page supports
search, status filtering, URL-backed pagination, and sorting by update time,
creation time, estimated value with nulls last, or name. The detail page
includes editable CRM fields, linked tasks, a follow-up form, and the unified
timeline. Editable lead fields keep local draft state, while the derived
"Next follow-up" value is rendered directly from the latest read-only server
prop so task revalidation updates it without erasing unsaved CRM edits.

Lead changes generate specific events for stage, value, follow-up, contact,
company, notes, and source changes rather than one vague update event.

### Inbox and Gmail

Users can connect a Gmail mailbox with read-only scope, request a background
sync, inspect user-friendly progress/results, search and filter imported
conversations, review full stored threads, classify conversations, change
review/lifecycle state, attach or detach a lead, create a lead from a
conversation, and create related tasks.

Imports are normalized behind a provider interface, preserve user-owned
conversation fields, deduplicate accounts/conversations/messages, maintain
last-message time monotonically, and use deterministic owner-scoped matching.
First import establishes a quiet historical baseline; later messages can
produce meaningful events. LeadHome does not send mail or modify Gmail.
Details are in [inbox.md](./inbox.md),
[messaging-import.md](./messaging-import.md), and
[google-gmail-setup.md](./google-gmail-setup.md).

### AI Conversation Intelligence

Conversation Intelligence is opt-in and disabled by default. Eligible attached
conversations can be analyzed automatically after meaningful Gmail changes,
and enabled users can explicitly analyze or reanalyze a conversation.
Analysis runs in the worker and produces factual structured summaries,
suggested contact/company/project details, explicit budget/timeline evidence,
sentiment, action suggestions, and missing information.

The Inbox presents expandable summaries, key details, contact links, copy
controls, and task-prefill links. Suggested data remains separate from Lead
fields. Analysis never automatically changes pipeline stages, edits leads, or
creates tasks. See
[conversation-intelligence.md](./conversation-intelligence.md).

### Pipeline

The Pipeline page is an owner-scoped, URL-filtered, bounded stage board with
aggregate metrics. Users can sort/filter cards and move leads through stages
by mouse, touch, or an accessible select control. Moves are optimistic,
transactional, and rollback on failure; the shared status service records one
meaningful activity. See [pipeline.md](./pipeline.md).

### Tasks

Users can create, edit, complete, reopen, cancel, delete, search, filter, sort,
and paginate tasks. Tasks may link to a lead and/or conversation. Buttons show
pending states and use shared transactional actions. `/reminders` redirects to
the upcoming task view because tasks are the sole reminder model.

Open follow-up tasks are the source of truth for the lead's follow-up summary.
Task lifecycle and follow-up summary changes write activity without copying
task notes. After task creation, one-off values clear while a lead-detail form
preserves its lead and `FOLLOW_UP` defaults for immediate resubmission. See
[tasks.md](./tasks.md).

### Website Sources

Settings can create, rotate, activate/deactivate, delete, and test website
sources. A token is shown once; only its hash is retained. External website
servers can submit validated leads through `POST /api/inbound/forms`.
Optional source-scoped idempotency, request-size limits, per-source/IP rate
limits, and browser-origin rejection protect ingestion. See
[inbound-forms.md](./inbound-forms.md).

### Activity Tracking

`lib/activity-service.ts` is the single typed recording path for new unified
events. It validates owner relationships, normalizes bounded titles and
descriptions, supports explicit business timestamps and structured metadata,
and uses database uniqueness for idempotent events.

Integrated workflows include lead creation and meaningful edits, website
submissions, Gmail conversation import, new messages, automatic/manual
conversation attachment and detachment, conversation status changes, AI
analysis completion, task lifecycle changes, pipeline moves, and follow-up
summary synchronization.

Lead detail displays date-grouped activity, actor/source context, related
entity links, missing-entity fallbacks, relative and exact times, loading and
error route states, and cursor-based older-history loading. Initial activity
presentation and row markup are server-rendered from primitive DTOs; only the
Load older pagination control and appended pages are client state. There is no
`ssr: false` timeline wrapper. Dashboard Recent Activity uses the same data.
See
[lead-activity-timeline.md](./lead-activity-timeline.md).

### Settings and Integrations

Settings shows account/login state, supports safe Google login linking and
unlinking, exposes the Conversation Intelligence opt-in and configuration
availability, manages Gmail connections and recent sync status, and manages
website sources. Gmail and website forms are the only implemented external
acquisition integrations.

## Important Workflows

- **Gmail synchronization:** Connect Gmail through a short-lived OAuth state;
  store encrypted tokens; enqueue an owner-scoped `GMAIL_SYNC` job; claim it
  through the worker; normalize and import threads; match leads; record
  meaningful activity; persist safe progress/result; refresh the Inbox when
  terminal.
- **Attach a conversation:** Authenticate; validate both conversation and lead
  ownership; update attachment/review/match state transactionally; update the
  lead's activity timestamp behavior; record detached/attached events only
  when the relationship changes.
- **Run AI analysis:** Check owner, preference, conversation eligibility,
  content hash, and active idempotent job; enqueue typed work; prepare bounded
  plain text; call OpenAI from the worker; validate strict output; lease-fence
  canonical persistence; record `AI_ANALYSIS_COMPLETED`.
- **Create a task from an AI suggestion:** Pass only the owned analysis ID and
  bounded suggestion index to a server-side prefill service; open the editable
  task form; require explicit user submission before creating the task.
- **Create a website source:** Authenticate; generate a high-entropy token;
  store only its hash; show the token once; allow later rotation rather than
  recovery.
- **Receive a website lead:** Reject browser-origin requests; authenticate the
  source bearer token; rate-limit; size-limit and validate JSON; deduplicate an
  optional idempotency key; transactionally create the owned lead, submission
  record, and website activity.
- **Synchronize follow-ups:** Task mutations transactionally recompute the
  earliest open follow-up due date for affected leads and record a
  `FOLLOW_UP_CHANGED` event only when that summary changes.
- **Create or update a lead:** Parse form data; authenticate; write through an
  owner-scoped transaction; create a lead-created event or specific
  field-change activities; update pipeline and lead routes.
- **Execute background work:** An authenticated user enqueues; a separately
  authenticated worker invocation recovers/claims; a typed handler
  checkpoints progress; completion/retry/failure is persisted with lease
  guards; clients poll safe owner-scoped status routes.

## API Routes and Server Actions

Important route handlers are:

- `/api/auth/[...nextauth]`: Auth.js handlers.
- `GET /api/gmail/connect` and `GET /api/gmail/callback`: authenticated Gmail
  authorization and credential persistence.
- `POST /api/inbound/forms`: server-to-server website lead ingestion.
- `POST /api/internal/jobs/run`: machine-authenticated bounded worker runner.
- `GET /api/cron/jobs`: `CRON_SECRET`-authenticated production Vercel Cron
  trigger for the same bounded runner.
- `GET /api/jobs/status`: owner-scoped Gmail job polling.
- `GET /api/jobs/conversation-analysis/status`: owner-scoped AI job polling.
- `GET /api/leads/[id]/activities`: authenticated, owner-scoped cursor pages
  for a lead timeline with `no-store` responses.

Server actions cover authentication, lead CRUD, pipeline movement, Inbox
controls, conversation attachment/detachment and lead creation, Gmail
enqueue/disconnect, task lifecycle, website source management, Conversation
Intelligence preference, and analysis enqueue/reanalysis.

The common mutation pattern is: authenticate, parse with Zod or a bounded
typed parser, perform owner-scoped domain work (usually in a Prisma
transaction), return a safe result, and revalidate or redirect affected
routes. Long-running provider work is enqueued rather than executed in a
server action.

## UI Architecture

The root layout renders a responsive authenticated sidebar, mobile navigation,
global font, theme classes, and the main content area. Major pages are:

- `/` Dashboard
- `/leads`, `/leads/new`, and `/leads/[id]`
- `/inbox` and `/inbox/[conversationId]/create-lead`
- `/pipeline`
- `/tasks`, `/tasks/new`, and `/tasks/[id]/edit`
- `/settings`
- `/login` and `/register`

Pages are server components by default and perform authenticated data loading.
Client components are used where local state, pending actions, polling,
clipboard access, drag/touch interaction, theme persistence, or incremental
activity loading is required. URL query parameters back list search, filters,
sorting, selection, and pagination.

The lead timeline follows that boundary deliberately. A server-only presenter
converts activity records into primitive display DTOs, and the first bounded
page and rows are rendered on the server. The small pagination island receives
only cursor/render primitives and owns fetching and appending older rows.
Static timeline content is not wrapped in a client-only dynamic import.

Shared UI includes `PageHeader`, dashboard/metric cards, status badges, lead
rows, the sidebar, action-state forms, task action buttons, the pipeline
board, Inbox controls, Conversation Intelligence cards, Recent Activity, and
the lead activity timeline.

Tailwind utilities define most presentation. `app/globals.css` provides theme
tokens, global focus/cursor behavior, and dark-mode overrides for major
surfaces. Lucide provides icons. Responsive behavior is expressed through
Tailwind breakpoints rather than a separate layout library.

Lead detail has route-specific `loading.tsx` and `error.tsx` states, and the
timeline has an inline load-more retry state. Other forms and job cards
generally use `useActionState`, disabled pending controls, live regions, and
safe inline messages. Loading/error boundaries are not yet consistently
defined for every route.

`next.config.ts` explicitly disables Next.js 16.2.11's optional
`experimental.reactDebugChannel`. Firefox development navigation proved that
the channel could see `transferSize === 0` with no matching request storage
key and invoke its cache-restore `location.reload()` fallback repeatedly.
Chrome passed the same flow; Firefox Webpack development also produced extra
reloads, so the failure was not Turbopack-only. Production did not contain the
development debug channel.

## Security and Reliability Measures

Verified protections include:

- Owner-scoped reads and writes throughout domain services and page queries.
- Cross-owner relationship validation before unified activity writes.
- JWT-backed authenticated routes plus explicit service-level ownership
  checks.
- Credentials validation and bcrypt password hashing.
- One-use, ten-minute, HMAC-hashed Gmail OAuth state.
- AES-256-GCM encryption for Gmail access and refresh tokens.
- Gmail read-only scope; no send/modify permission.
- One-time website source secrets stored only as hashes and compared safely.
- Browser-origin rejection, bounded bodies, Zod validation, rate limiting, and
  optional idempotency for inbound forms.
- Unique provider IDs and transactional import behavior for message
  idempotency.
- Monotonic conversation last-message timestamps.
- Typed activity enums, bounded text, structured metadata, explicit occurrence
  time, owner-scoped idempotency, and stable cursor ordering.
- Atomic job claims, leases, heartbeats, fenced writes, bounded retries,
  cancellation, stale recovery, execution budgets, and safe error storage.
- Polling-delay shutdown listeners are removed after both normal timers and
  aborts, preventing a long-running local worker from accumulating listeners.
- Separate timing-safe, high-entropy local-worker and production-cron secrets.
- Strict AI input/output bounds, provider-response non-retention, prompt
  injection defenses, evidence validation, and explicit confirmation before
  CRM mutations.

Known weaknesses include the lack of multi-factor authentication, password
reset, roles/teams, comprehensive audit administration, and browser end-to-end
security tests. Expired/consumed `OAuthState` rows have no documented cleanup
service. Public Gmail use still depends on completing Google's consent and
scope-verification requirements. Production job progress depends on an active
Vercel Pro cron, a valid Production `CRON_SECRET`, healthy database/provider
connections, and operator monitoring.

## Existing Tests and Verification

Vitest runs in a Node environment with a `server-only` test shim. The
repository contains unit and structural regression coverage for:

- Auth/proxy and validation behavior.
- Lead mutations, sorting, owner isolation, and activity generation.
- Unified activity recording, cross-owner rejection, idempotency, ordering,
  cursor pagination, related links, empty states, and dashboard queries.
- Website source and inbound-route authentication, validation, rate limiting,
  and deduplication.
- Messaging normalization, matching, imports, last-message behavior, Inbox
  queries, and conversation controls.
- Gmail OAuth/token helpers, provider behavior, job enqueue/status, handlers,
  retries, leases, runner security, and local worker behavior.
- Conversation Intelligence configuration, input preparation, strict schema,
  provider behavior, job lifecycle, UI presentation, and task prefill.
- Task lifecycle, follow-up synchronization, filters, sorting, actions, and
  forms.
- Pipeline metrics, queries, optimistic movement, rollback, and UI behavior.
- Prisma migration text/schema invariants.
- Focused Firefox and Chrome lead-detail acceptance covering direct
  navigation, repeated refresh, timeline rendering, dated follow-up creation,
  and immediate derived-date display.

Normal tests mock external providers and database clients. The OpenAI smoke
test is opt-in and uses synthetic content. The Selenium scenario is a focused
regression rather than a broad browser suite, and most tests are not
real-PostgreSQL integration tests. Production Gmail and OpenAI behavior still
require environment-specific smoke verification.

Repository verification commands are:

```text
npm run db:validate
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run build
npm run validate
git diff --check
```

Lead-detail stabilization additionally verified the initiating browser
behavior rather than relying only on source assertions. Firefox reproduced the
Next.js development debug-channel reload fallback; Chrome passed; Webpack
development still showed extra Firefox reloads; and production output did not
contain the debug channel. The final server-rendered timeline and read-only
follow-up prop flow passed the focused Firefox and Chrome scenario. Node
24.18.0 and Node 26.5.0 both passed the stabilized application/build checks;
24.18.0 is the final LTS pin because it contains the TransformStream race fix
and matches Vercel's configured 24.x runtime. The worker regression also
verified zero retained abort listeners after each of 12 polling delays.

Current verification passes under Node 24.18.0: Prisma format, schema
validation, and client generation; deployment of
`20260727230000_unified_activity_timeline` and
`20260727231500_correct_unified_activity_provenance`; migration status with all
17 migrations applied; 50 focused job/cron regressions; 384 full-suite tests
with one opt-in OpenAI smoke test skipped; TypeScript; ESLint; and the Next.js
production build, including dynamic `/api/cron/jobs` output.

## Known Limitations and Technical Debt

- Existing activity rows receive the best timestamp/source/actor information
  that can be reconstructed; leads with no historical rows are not given
  invented history.
- The dashboard activity list is recency-based with a static meaningful-type
  allowlist, not a configurable priority or attention model.
- There is no automatic periodic Gmail enqueue. Vercel Cron drains durable
  jobs already created by user/application activity once per minute.
- Gmail is read-only. Email sending, drafts, attachments/proposals analysis,
  Outlook, social messaging, SMS, and WhatsApp are not implemented.
- Smart matching is deliberately limited to durable submission identifiers
  and exact normalized email evidence. Fuzzy or AI matching is absent.
- AI suggestions cannot be applied to CRM fields in a reviewed confirmation
  flow; they are display-only except for explicit task-form prefill.
- There is no notification center, automation rules engine, team workspace,
  billing, advanced reporting, or sales forecasting.
- List pagination outside activity commonly uses offset pages or bounded
  incremental limits.
- Due-date and date-group display relies on runtime/browser local time; users
  do not have a stored timezone preference.
- Loading and error boundaries are not consistent across all routes.
- OAuth state retention has no explicit cleanup path.
- The lead-detail browser regression is deliberately narrow; there is still no
  broad browser or real-database integration suite.
- Next.js's optional React debug channel remains disabled in development until
  its Firefox cache-restore fallback is safe.

## Current Product Readiness

LeadHome is best described as a **private alpha candidate**.

It has a coherent owner-scoped CRM domain, secure website ingestion, a usable
Inbox and pipeline, transactional task/follow-up behavior, a generic
recoverable job system, conservative AI analysis, unified activity history,
and substantial automated regression coverage.

Public or paid readiness is blocked by verifying production worker operations
and alerting, Google public-app review, broader end-to-end and real-database
testing,
account-recovery/security features, and operational monitoring. The product
also lacks team administration, billing, and the notification/attention
workflows expected for broader self-service use.

## Current Phase 2 Priorities

- [x] **Unified Activity Timeline**
- [ ] **Smart Lead Matching** — exact owner-scoped email and submission-ID
  matching exist as a conservative foundation; the broader milestone remains.
- [ ] **Automatic Company Detection** — AI may suggest a company, but no
  automatic or reviewed application flow exists.
- [ ] **Contact Extraction** — AI may suggest contact details, but extraction
  is not an applied CRM workflow.
- [ ] **Inbox Prioritization**
- [ ] **Dashboard Needs Attention**
- [ ] **AI Buying Signal Detection**
- [ ] **Follow-up Detection**
- [ ] **Notification Center**
- [ ] **Automation Rules Engine**

## Architectural Decisions to Preserve

- Treat `User.id` as the tenant boundary and include it in every read, write,
  cursor, job, and relationship validation.
- Keep domain mutations in shared server services and combine the business
  write and activity record in one transaction.
- Extend the existing generic `Job` queue for suitable future background work
  instead of creating feature-specific queues.
- Keep provider normalization separate from provider-agnostic import logic.
- Preserve provider-owned and user-owned messaging fields explicitly; imports
  must not overwrite user decisions.
- Use monotonic timestamps and database uniqueness for retry-safe ingestion.
- Record meaningful business activity through `lib/activity-service.ts`;
  avoid direct duplicate event-building paths and low-level sync noise.
- Use explicit occurrence timestamps and stable ID tie-breakers.
- Keep Tasks as the source of truth for follow-up work and
  `Lead.nextFollowUpDate` as a derived query summary.
- Render derived read-only lead values from current server props while keeping
  editable drafts local; do not add effects or refresh loops to reconcile
  them.
- Server-render initial activity content and keep only older-page pagination
  in a minimal client island with primitive DTOs.
- Require explicit user confirmation for AI-suggested CRM changes or tasks.
- Keep secrets and provider work server-only, store only safe job metadata,
  and expose bounded user-facing errors.
- Keep the supported Node major aligned with Vercel (`24.x`) and use an exact
  current LTS pin locally. Do not require an unsupported future/current major
  for a fix already backported to Node 24.
- Use URL-backed server queries for durable search/filter/sort state and
  bounded query shapes for dashboard/list surfaces.
- Add new Prisma migrations; never rewrite previously applied migrations.

## Open Questions

- When should the single-user owner model become a workspace/team model, and
  how should activity actors represent multiple human users?
- What monitoring/alerting should detect a stalled Vercel Cron or growing
  durable queue?
- Should users receive a stored timezone so due dates, activity date groups,
  and dashboard day boundaries are consistent across server and browser?
- Should Recent Activity remain chronological, or should a separate
  explainable Needs Attention score prioritize replies, overdue work, and
  buying signals?
- What reviewed confirmation flow should apply AI-extracted company/contact
  data without permitting autonomous CRM edits?
- Should overdue-task transitions become stored activities, or remain derived
  state until a reliable scheduler exists?
- What retention policy should remove expired OAuth states and, if needed,
  old activity metadata without losing useful audit history?
- What proposal/attachment model is needed before proposal detection can be a
  trustworthy activity type?
- Which additional browser and real-PostgreSQL integration scenarios should
  extend the focused lead-detail acceptance check before moving from private
  alpha to a broader beta?
