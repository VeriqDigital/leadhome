# Unified activity timeline

LeadHome uses the existing `LeadActivity` table as its single business-event
history. Migration `20260727230000_unified_activity_timeline` extends that table
in place; it does not introduce a parallel audit model or discard existing
activity IDs. Follow-up migration
`20260727231500_correct_unified_activity_provenance` corrects legacy provenance
where canonical Gmail and automatic-match data makes the original source and
actor precisely identifiable.

## Data model

Every activity belongs to one user and has a typed `LeadActivityType`, actor
type, source, human-readable title, optional description and JSON metadata,
business `occurredAt` time, and insertion `createdAt` time. It can link to a
lead, conversation, message, or task. At least one lead, conversation, or task
link is required when an activity is recorded.

Lead, conversation, message, and task links use `ON DELETE SET NULL`, so deleting
an operational record does not delete its history. Deleting the owning user
still cascades that user's activities. A lead timeline contains only events
whose `leadId` points to that lead; conversation-only and task-only history is
valid but does not appear on an unrelated lead.

Actor types are `USER`, `CONTACT`, `SYSTEM`, and `AI`. Sources are `MANUAL`,
`WEBSITE`, `GMAIL`, `INBOX`, `TASK`, `AI`, and `SYSTEM`. Stable event types cover
lead creation and field changes, website submissions, conversation import,
linking and status changes, inbound and outbound messages, AI completion, and
the task lifecycle.

Indexes support owner, lead, conversation, task, message, type, and
`occurredAt` queries. `(userId, idempotencyKey)` is unique, as is
`(messageId, type)`.

## Recording and authorization

`lib/activity-service.ts` is the shared server-only recording path.
`recordActivity()` and `recordActivities()` accept an existing Prisma client or
transaction so the business mutation and its activity normally commit
together. A batch must have one owner. Before writing, the service verifies
that every supplied lead, conversation, task, and message belongs to that
owner, that a message belongs to the supplied conversation, and that linked
task relationships do not conflict. Message activity also rejects a supplied
lead that does not match the conversation's current lead.

Titles, descriptions, and idempotency keys are normalized and bounded.
Retry-prone imported and background-generated events use deterministic
idempotency keys when a stable external identity exists, and message activity
also has a database uniqueness guard. Batch creation uses `skipDuplicates`
when an idempotent key is present, making retrying those writes safe.

`occurredAt` is the business timestamp and controls timeline order. It may be a
message's provider timestamp or a background job's completion time rather than
the later database insertion time. `createdAt` remains the immutable insertion
timestamp.

## Recorded workflows

- Manual lead creation and meaningful lead edits record granular events for
  status, estimated value, contact information, company, notes, and source
  changes. The read-only follow-up summary is changed only by task
  recalculation.
- Website ingestion records one `WEBSITE_SUBMISSION_RECEIVED` event titled
  "Website lead created" in the same transaction as the lead. This represents
  both the submission and resulting lead without duplicating the same business
  action. When the request has an idempotency key, its activity key is derived
  from the owned website source and the hashed request key.
- A newly imported Gmail or fixture conversation records one idempotent
  `CONVERSATION_IMPORTED` event. Its initially imported message history remains
  a silent baseline. Messages first seen on later imports record body-free
  inbound or outbound events when the conversation is attached to a lead,
  using the provider message timestamp.
- Manual attach and detach operations record user/Inbox events. A deterministic
  Gmail auto-match records a system/Gmail link event, and a user-approved Smart
  Lead Matching suggestion uses the same owner-scoped manual attachment
  service. Candidate calculation, display, ranking, dismissal, and
  single-conversation reevaluation do not create activity. Meaningful
  conversation status changes are recorded for both linked and unattached
  conversations; only linked events appear in a lead timeline.
- Task creation, meaningful edits, completion, reopening, cancellation, and
  deletion record task events, including for standalone and conversation-only
  tasks. Follow-up summary changes are recorded separately by the
  transactional recalculation service. Deleted tasks leave their history in
  place with a null task relation.
- A successful Conversation Intelligence job records
  `AI_ANALYSIS_COMPLETED` in the same lease-fenced transaction as canonical
  analysis completion. Creating a task from an AI suggestion still requires an
  explicit user save and records validated analysis provenance; AI does not
  create tasks or change lead fields automatically.

Classification and review-state changes, AI request/failure states, derived
overdue transitions, and proposal or attachment detection do not currently
create activities. Low-level sync phases and no-op refreshes are deliberately
excluded.

## Existing-data compatibility

The migration preserves existing activity rows. It initializes `occurredAt`
from `createdAt`, then replaces that value with `Message.receivedAt` for
message-linked rows. It restores typed `taskId` links from legacy
`metadata.taskId` only when the referenced task belongs to the same owner.

Legacy actor and source values start from event-type inference because the
original rows did not store those fields. The corrective migration then uses
surviving conversation/message provider data and `metadata.automatic` to
restore precise Gmail-message and automatic-link provenance. Remaining legacy
values are approximate. Events deleted by the previous lead-cascade behavior
cannot be reconstructed, and no synthetic history is fabricated for actions
that were never recorded.

## Lead timeline and API

The lead detail page loads 20 activities at a time through the owner-scoped
query in `lib/activity-service.ts`. Results are ordered by
`occurredAt DESC, id DESC`; the ID is the stable equal-time tie-breaker. The
authenticated `GET /api/leads/[id]/activities?cursor=<activity-id>` route
validates that both the lead and cursor belong to the owner and lead, returns
the next bounded page, and disables caching.

The initial timeline is a Server Component. The server-only presentation layer
converts database-shaped activity values and metadata into primitive display
DTOs containing strings, nulls, and small discriminated related-record
objects. It groups and formats the first page in one server-selected render
time zone, then server-renders the full initial row markup with event glyphs,
supporting details, exact and relative times, source and actor context, and
links to surviving tasks or conversations. The serialized render time and
zone keep later pages consistent with that initial page.

Only `ActivityTimelinePagination` is a Client Component. It receives the lead
ID, cursor, initial activity IDs, preceding day key, render time, and time zone
as primitive props. It requests older primitive display DTOs from the
authenticated API, de-duplicates IDs defensively, and appends reusable row
markup. Empty, loading, load-more, retry, end-of-history, and
missing-related-record states remain available. The final architecture does
not use `next/dynamic`, a client-only timeline wrapper, or `ssr: false`.

Creating a follow-up from the lead page commits the task, derived lead summary,
task activity, and optional follow-up-change activity before the lead route is
revalidated. The task list and timeline use the refreshed server payload. The
lead form retains local state only for editable CRM fields and composes the
read-only follow-up value directly from the current server prop on each
render. The new summary therefore appears immediately without discarding
unsaved edits, adding a synchronization effect, or calling `router.refresh`.

## Lead-detail reload stabilization

The repeated full-document navigation was proven to originate in the optional
Next.js 16.2.11 development React debug channel. In Firefox, a navigation
performance entry could report `transferSize === 0` while the debug channel's
request key was absent from session storage. The channel interpreted that
combination as a cache restore and used its fallback `location.reload()`,
which created another zero-transfer navigation and could repeat indefinitely.
Persisted activity data, timeline DTO size, and the follow-up transaction were
not the initiating cause; creating a follow-up merely made the affected
lead-detail refresh path easy to reproduce.

This behavior reproduced in Firefox development with Turbopack and also
produced extra reloads with Webpack, so it was not a Turbopack-only failure.
Chrome passed the same route flow. The production client did not include the
development debug channel. `next.config.ts` now sets
`experimental.reactDebugChannel` to `false`, preventing the faulty fallback
without changing production rendering or application data.

Disabling that channel is the framework stabilization. Separately, keeping the
initial activity content server-rendered and isolating only pagination is the
preferred product architecture: it avoids sending static history through a
large Client Component boundary while retaining pagination and accessible
states. The temporary `ssr: false` workaround is not part of the final design.

The runtime is pinned locally to Node 24.18.0 with a `24.x` package engine,
matching the linked Vercel project's configured Node 24.x runtime. Node
24.18.0 includes the upstream TransformStream cancellation-race correction
that first shipped on the Node 24 line in 24.15.0. Node 26.5.0 also passed the
stabilized flow, but it is a comparison runtime rather than the production
requirement.

## Dashboard recent activity

The Dashboard retains its existing cards and adds a bounded Recent Activity
list. Its owner-scoped query currently includes meaningful recent events:
inbound messages, website submissions, AI completion, lead status and
follow-up changes, task completion, conversation attachment, and lead
creation. It uses the same `occurredAt DESC, id DESC` order and returns no more
than 20 items. This is a recency list, not an attention score or notification
system.
