# Phase 2 Progress

## Current Milestone

Unified Activity Timeline was implemented by extending LeadHome's existing
activity history. The iteration centralizes activity recording, integrates the
major lead, website, conversation, Gmail, task, pipeline, and AI completion
workflows, upgrades the lead timeline, and adds a compact Dashboard Recent
Activity list. A follow-up stabilization pass then fixed controlled lead-form
state and persisted task rendering without starting another roadmap milestone.
That stabilization work also isolated and disabled a Next.js development-only
reload fallback, split the timeline into server-rendered content plus a small
pagination island, aligned the runtime with Vercel, and retained the worker
listener cleanup.

## Milestone Status

Complete

The implementation, additive migration, focused regressions, full test suite,
TypeScript, lint, and production build have all been verified. The configured
database reports all 17 repository migrations applied.

## Features Completed

- [x] Unified Activity Timeline
- [ ] Smart Lead Matching
- [ ] Automatic Company Detection
- [ ] Contact Extraction
- [ ] Inbox Prioritization
- [ ] Dashboard Needs Attention
- [ ] AI Buying Signal Detection
- [ ] Follow-up Detection
- [ ] Notification Center
- [ ] Automation Rules Engine

## What Changed

- Lead detail pages now present business events as a date-grouped timeline with
  event icons, useful context, exact and relative times, related-record links,
  and missing-record fallbacks.
- Long timelines use a bounded Load older activity flow with loading, retry,
  and empty states rather than loading unlimited history.
- The Dashboard retains its existing cards and adds an owner-scoped Recent
  Activity list for selected high-value event types.
- Core mutations and import/background workflows now use a shared recorder
  instead of constructing activity rows independently.
- Business occurrence time is distinct from insertion time, so provider
  messages and completed AI work appear where they happened.
- Lead-page follow-up creation now shows the recalculated lead date, new task,
  and activities from the same refreshed server result without leaving the
  page.
- Persisted follow-ups render directly from the latest read-only server prop
  while unsaved editable lead fields remain local, so ordinary lead-page
  renders perform no refresh, navigation, state-reconciliation effect, or
  write.
- The initial activity page and its formatted rows are server-rendered from a
  primitive presentation DTO. Only the Load older control and appended pages
  are a Client Component; the final design does not use `ssr: false`.
- A Firefox document-reload storm was traced to Next.js 16.2.11's optional
  development React debug channel, not persisted activity or follow-up data.
  The channel is disabled explicitly in `next.config.ts`.

## Architectural Changes

- Reused and extended `LeadActivity` so the product has one history rather than
  two competing event systems.
- Added `lib/activity-service.ts` as a server-only recording and query boundary.
  It validates owner-scoped relationships and accepts an existing transaction
  so an activity normally commits atomically with its business mutation.
- Added typed actor and source enums and continued using the existing typed
  activity enum instead of accepting arbitrary strings.
- Added deterministic idempotency keys and database uniqueness constraints for
  work that can be retried, imported twice, or run concurrently.
- Added `occurredAt` for business chronology while retaining `createdAt` as the
  database insertion time.
- Added cursor pagination ordered by `occurredAt DESC, id DESC`; the ID is the
  deterministic equal-time tie-breaker.
- Kept Dashboard prioritization as a small allowlist query so a future
  attention-scoring system can evolve separately.
- Kept `Task` as the sole follow-up source of truth. The lead form ignores its
  read-only follow-up field on writes and derives only that rendered value
  from the revalidated server prop.
- Moved timeline presentation into a server-only formatter. Initial rows cross
  no Client Component boundary; the pagination island receives only strings,
  string arrays, and nullable cursor/day values.
- Disabled `experimental.reactDebugChannel` for development. In Firefox,
  Next.js treated a navigation entry with `transferSize === 0` and a missing
  request storage key as a cache restore and called `location.reload()`.
  Chrome did not reproduce the loop, Webpack development still produced extra
  reloads, and the production client did not contain this debug channel.
- Pinned local Node to `24.18.0` and the package engine to `24.x`, matching the
  linked Vercel project's `24.x` runtime. Node 24.18 includes the upstream
  TransformStream cancellation-race fix; Node 26.5 remains a verified
  comparison runtime rather than the deployment requirement.

## Database Changes

Exact migrations:

- `20260727230000_unified_activity_timeline`
- `20260727231500_correct_unified_activity_provenance`

- Extended `LeadActivity`; no new activity model was created.
- Made `leadId` optional and added optional `taskId`.
- Added `LeadActivityActorType` and `LeadActivitySource`.
- Added `CONVERSATION_IMPORTED`, `CONVERSATION_STATUS_CHANGED`, and
  `AI_ANALYSIS_COMPLETED` to `LeadActivityType`.
- Added `actorType`, `source`, `occurredAt`, and optional `idempotencyKey`.
- Changed lead deletion from cascading activity deletion to `SET NULL`; task,
  conversation, and message relations also preserve history with `SET NULL`.
  User deletion still cascades the owner's activities.
- Added the `(userId, idempotencyKey)` unique constraint and retained the
  existing `(messageId, type)` duplicate guard.
- Added timeline and lookup indexes for lead, owner, conversation, task,
  message, and owner/type queries using `occurredAt`.
- Preserved existing rows. The migration initializes `occurredAt` from
  `createdAt`, uses `Message.receivedAt` when a linked message provides a more
  precise timestamp, and restores owned task links from legacy
  `metadata.taskId`.
- Legacy actor and source values are inferred from event type. Exact historical
  Gmail-message and automatic-link provenance is then corrected where
  surviving canonical records make it identifiable. Provenance that was never
  stored or cannot be inferred cannot be reconstructed.

## Workflow Integrations

- Manual lead creation records `LEAD_CREATED`.
- Lead editing records granular status, value, contact, company, notes, and
  source changes instead of one vague update. Follow-up changes come only from
  task recalculation.
- Pipeline status moves use the same transactional status/activity service.
- Website form and test-source ingestion record one owner-scoped website
  submission event; external idempotency keys also protect the activity.
- First conversation imports record one idempotent conversation event while
  initial messages remain a silent baseline.
- Later inbound and outbound messages on attached conversations record
  body-free events at the provider timestamp.
- Manual attach/detach, deterministic Gmail auto-link, and meaningful linked
  or unattached conversation status changes record activities.
- Task creation, meaningful editing, completion, reopening, cancellation, and
  deletion record events for lead-linked, conversation-only, and standalone
  tasks.
- Follow-up recalculation records a separate system event when the lead summary
  changes.
- Successful Conversation Intelligence completion records one idempotent AI
  event in the same lease-fenced transaction as the canonical analysis.
- Explicitly saving a task prefilled from an AI suggestion records validated
  analysis provenance. AI still does not mutate CRM state automatically.

Deferred activity includes classification/review-state changes, AI
request/failure events, synthesized overdue transitions, and proposal or
attachment detection. Low-level sync progress and no-op refreshes remain
operational data, not business activity.

## Files Added

- `lib/activity-service.ts` — centralized recording, validation, timeline
  pagination, and Dashboard queries.
- `lib/activity-service.test.ts` — recorder, owner isolation, pagination, and
  Dashboard query coverage.
- `app/api/leads/[id]/activities/route.ts` and its test — authenticated,
  owner-scoped cursor endpoint.
- `app/recent-activity.tsx` and its test — compact Dashboard activity list.
- `app/leads/[id]/loading.tsx` and `app/leads/[id]/error.tsx` — polished lead
  detail loading and error states.
- `app/leads/[id]/page.test.tsx` — persisted follow-up, repeated-render, task,
  and activity regression coverage.
- `app/leads/activity-timeline-pagination.tsx`,
  `app/leads/activity-timeline-rows.tsx`, and
  `lib/activity-presentation.ts` — minimal client pagination, reusable static
  rows, and server-only conversion to primitive display data.
- `.node-version` — exact local Node 24.18.0 runtime pin.
- `scripts/lead-detail-browser.mjs` — focused Firefox and Chrome lead-detail
  acceptance coverage.
- `prisma/migrations/20260727230000_unified_activity_timeline/migration.sql` —
  additive schema extension and compatibility backfill.
- `prisma/migrations/20260727231500_correct_unified_activity_provenance/migration.sql`
  — additive correction for identifiable legacy Gmail and automatic-link
  provenance; the already-applied schema migration remains unchanged.
- `docs/PROJECT_STATE.md` — repository-verified product and architecture
  baseline for future development.
- `docs/PHASE2_PROGRESS.md` — this Phase 2 implementation journal.

## Files Modified

- `prisma/schema.prisma` and `prisma/lead-activity-schema.test.ts` — unified
  activity fields, enums, relations, constraints, indexes, and migration
  assertions.
- `app/leads/[id]/page.tsx`, `app/leads/activity-timeline.tsx`, and timeline
  tests — server-rendered initial presentation, persisted follow-up rendering,
  primitive display data, and paginated older history.
- `app/page.tsx` — Dashboard Recent Activity integration.
- `app/actions/lead-actions.ts`, `lib/lead-activities.ts`, and related tests —
  centralized granular lead events.
- `app/actions/task-actions.ts`, `app/tasks/new/page.tsx`,
  `app/tasks/task-form.tsx`, `lib/tasks/task-service.ts`, and related tests —
  complete task lifecycle, follow-up, and validated AI-suggestion provenance.
- `app/leads/lead-form.tsx`, `app/actions/lead-actions.ts`,
  `app/tasks/task-due.tsx`, and related tests — read-only follow-up prop
  composition, task-only follow-up ownership, and stable persisted-date
  rendering without render-time state reconciliation.
- `app/tasks/task-form.tsx` and its tests — successful creation clears
  one-off values while preserving the lead-detail form's linked lead and
  `FOLLOW_UP` type for immediate resubmission.
- `next.config.ts`, `package.json`, and `package-lock.json` — disable the
  faulty development debug channel and align the supported Node major with
  Vercel.
- `scripts/jobs-worker.mjs` and its tests — remove each polling delay's abort
  listener when the timer settles or shutdown occurs.
- `lib/messaging/import-service.ts`, conversation mutation services, and their
  tests — imported conversation, message, link, unlink, and status events.
- `app/api/inbound/forms/route.ts`, `lib/inbound-sources.ts`, and tests —
  transactional website activity and retry idempotency.
- `lib/jobs/handlers/conversation-analysis.ts` and its tests — lease-fenced AI
  completion activity.
- `lib/jobs/handlers/gmail-sync.ts` — Dashboard refresh after completed Gmail
  work.
- `lib/pipeline/status-service.ts` and `lib/pipeline/pipeline-query.ts` —
  centralized status events and occurrence-time activity summaries.
- `docs/lead-activity-timeline.md` — rewritten for the unified model,
  compatibility behavior, workflows, API, UI, and Dashboard query.
- `docs/background-jobs.md`, `docs/conversation-intelligence.md`,
  `docs/google-gmail-setup.md`, `docs/inbound-forms.md`, `docs/inbox.md`,
  `docs/messaging-import.md`, `docs/pipeline.md`, and `docs/tasks.md` — narrow
  corrections for the activity integration and current implemented behavior.

## Testing and Verification

- `npx.cmd prisma format` — Passed; Prisma formatted
  `prisma/schema.prisma`.
- `npm.cmd run db:validate` — Passed; the Prisma schema is valid.
- `npm.cmd run db:generate` — Passed; Prisma Client 6.19.3 generated.
- `npm.cmd run db:migrate:deploy` — Passed; applied
  `20260727230000_unified_activity_timeline` and, in a later immutable
  follow-up, `20260727231500_correct_unified_activity_provenance`.
- `npx.cmd prisma migrate status` — Passed; 17 migrations found and the
  configured database schema is up to date.
- `npx.cmd vitest run prisma/lead-activity-schema.test.ts lib/activity-service.test.ts app/leads/activity-timeline.test.tsx "app/api/leads/[id]/activities/route.test.ts" app/recent-activity.test.tsx app/actions/lead-actions.test.ts lib/tasks/task-service.test.ts lib/messaging/import-service.test.ts lib/messaging/conversation-service.test.ts lib/messaging/conversation-control-service.test.ts lib/messaging/conversation-lead-service.test.ts app/api/inbound/forms/route.test.ts lib/jobs/handlers/conversation-analysis.test.ts lib/pipeline/status-service.test.ts`
  — Passed; 14 test files and 110 tests passed.
- `npx.cmd vitest run "app/leads/[id]/page.test.tsx" app/leads/lead-form.test.tsx app/actions/lead-actions.test.ts app/actions/task-actions.test.ts app/tasks/task-form.test.tsx lib/tasks/task-service.test.ts lib/lead-format.test.ts app/leads/activity-timeline.test.tsx`
  — Passed; 8 test files and 57 tests passed.
- `npm.cmd run typecheck` — Passed with no TypeScript errors.
- `npm.cmd run lint` — Passed with no ESLint errors.
- `npm.cmd test` — Passed; 66 test files and 365 tests passed. One
  environment-gated OpenAI smoke-test file/test was skipped as designed.
- `npm.cmd run build` — Passed; Prisma generation and the Next.js 16.2.11
  production build completed successfully.
- Focused real-browser verification — Firefox reproduced the development
  reload fallback before it was disabled; Chrome did not. Firefox development
  with both Turbopack and Webpack showed extra navigation behavior, while the
  production client did not contain the debug channel. The final
  server-rendered timeline and follow-up flow passed Firefox and Chrome
  acceptance checks.
- Runtime matrix — the stabilized application and production build were
  exercised on Node 24.18.0 and Node 26.5.0. Node 24.18.0 is the final local
  and Vercel-aligned runtime.
- Worker listener regression — 12 consecutive polling delays each returned
  the shutdown signal's abort-listener count to zero.
- `git diff --check` — Passed with no whitespace errors.

## Known Limitations

- Historical activity actor and source values remain best-effort where the old
  rows and surviving relations do not identify them. Gmail-message and
  automatic-link provenance is corrected when it is identifiable.
- Existing rows get precise business time only when linked message data exists;
  other legacy events retain their original insertion time.
- Activity already deleted by the old lead-cascade behavior cannot be
  recovered, and the migration does not fabricate events for unrecorded past
  actions.
- There is no dedicated conversation-wide or task-wide timeline UI yet.
  Conversation-only and task-only events are retained but appear on a lead
  timeline only when they also have that lead link.
- Dashboard Recent Activity is chronological and allowlisted. It is not Inbox
  prioritization, attention scoring, or a notification center.
- Derived overdue state does not create a durable event because no reliable
  transition scheduler exists.
- Proposal and attachment detection are not supported by current canonical
  data.
- Next.js's optional React debug channel remains disabled in development until
  its cache-restore fallback can distinguish Firefox's zero-transfer
  navigation entry without forcing a document reload.

## Decisions for Future Milestones

- Continue using `LeadActivity` and `lib/activity-service.ts`; do not add a
  second event table or bypass relationship validation.
- Use `occurredAt` for business ordering and `createdAt` for audit insertion
  time.
- Record workflow events inside the owning transaction whenever possible.
- Give imported and background-generated events deterministic, owner-scoped
  idempotency keys.
- Keep message bodies, private notes, AI output, credentials, and raw provider
  payloads out of activity descriptions and metadata.
- Preserve explicit user confirmation for AI-suggested CRM changes.
- Add a stable event type only for meaningful business history, not sync or
  queue noise.

## Next Recommended Milestone

Smart Lead Matching is the highest-impact next milestone. Gmail is already the
most developed acquisition channel, and the unified activity model now
provides owner-scoped conversation/lead relationships and an auditable place
to record a confirmed match. The existing exact-email auto-match should remain
the conservative automatic path; the next phase can add explainable,
reviewable suggestions for ambiguous conversations without silently attaching
fuzzy matches.

Automatic Company Detection and Contact Extraction should remain separate
follow-on milestones, and the matching phase should not add Outlook, social
channels, automatic AI CRM edits, or a general rules engine.

## Phase 2 Roadmap

- [x] Unified Activity Timeline
- [ ] Smart Lead Matching
- [ ] Automatic Company Detection
- [ ] Contact Extraction
- [ ] Inbox Prioritization
- [ ] Dashboard Needs Attention
- [ ] AI Buying Signal Detection
- [ ] Follow-up Detection
- [ ] Notification Center
- [ ] Automation Rules Engine
