# Phase 2 Progress

## Current Milestone

Automatic Company Detection is the current Phase 2 implementation milestone.
It extends the existing attachment and Conversation Intelligence workflows
with one conservative, explainable company-detection boundary. It does not add
a `Company` entity, competing company field, second queue, or LLM request.

The implementation is intentionally incremental:

- `Lead.company` remains the only company representation;
- one unambiguous company already associated with the same recognized business
  domain may fill a blank company automatically;
- AI and domain-formatted candidates require explicit review;
- existing attachments, companies, dismissals, and concurrent manual decisions
  always override automation.

## Milestone Status

**Implementation complete; final runtime validation pending.**

The feature and additive migration are implemented. The core detector, Inbox,
activity, attachment, and analysis integration passed its focused and full
regression runs. After the final Gmail non-blocking durable-job integration,
Prisma format/validate/generate, TypeScript, full ESLint, and
`git diff --check` passed. The expanded focused/full tests and Node 24
production build still need one final run before this milestone is marked
complete.

## Phase 2 Roadmap

- [x] Unified Activity Timeline
- [x] Smart Lead Matching
- [ ] Automatic Company Detection
- [ ] Contact Extraction
- [ ] Inbox Prioritization
- [ ] Dashboard Needs Attention
- [ ] AI Buying Signal Detection
- [ ] Follow-up Detection
- [ ] Notification Center
- [ ] Automation Rules Engine

Contact Extraction and the later attention/automation features remain separate
future milestones. Automatic Company Detection does not alter Smart Lead
Matching rules or apply AI output to lead identity.

## Automatic Company Detection

### Central boundary and triggers

`lib/messaging/company-detection-service.ts` is the single owner-scoped
detection, suggestion, dismissal, recheck, and application boundary. It reads
stored conversation, lead, message, analysis, and owned-lead association data;
it does not call Gmail or OpenAI.

The service runs after each of the four existing attachment service paths:
manual attachment, combined conversation-control attachment, lead creation or
duplicate-lead attachment from a conversation, and Smart Lead Matching's
automatic attachment. It also runs after a Conversation Intelligence result
has been successfully persisted so newly available structured evidence can be
presented. Interactive paths run the detector immediately so their canonical
server response includes the result. A Gmail-imported automatic attachment
enqueues an idempotent `COMPANY_DETECTION` job on the existing durable queue
instead, keeping nonessential company work outside the import. The queued
handler re-evaluates current owner, attachment, evidence, and company state, so
stale work is a safe no-op. Fake-provider imports remain immediate for local
development.

### Automatic application boundary

Automatic application requires all of the following at the same canonical
owner-scoped read:

- the conversation is attached to the same owned lead;
- that lead's `company` is still blank;
- stored inbound sender/reply-to evidence contains a credible external
  identity;
- the identity resolves to exactly one recognized business domain;
- other owned leads on that domain have a nonblank company and all normalize
  to exactly one company value;
- the bounded association lookup has not overflowed;
- no structured AI company conflicts with the domain association;
- the candidate/evidence fingerprint is not currently dismissed; and
- the compare-and-set update confirms that neither the attachment nor company
  changed concurrently.

If any condition fails, the service leaves `Lead.company` unchanged. The
target lead itself is excluded from association evidence. Company names are
normalized only for comparison; the selected existing display value is
preserved when applied.

### Domain and identity safety

Company evidence uses only credible external inbound sender/reply-to identity.
It excludes outbound messages, the connected mailbox and owner identity,
unrelated recipients, malformed addresses, system-only senders, public mailbox
providers, common disposable providers, and common relay/infrastructure
domains. Every bounded stored mailbox address for the owner is excluded; if
that mailbox lookup overflows, detection fails closed instead of treating an
unknown owner identity as external.

Subdomains are handled through the conservative explicit suffix utility in
`lib/messaging/email-domain.ts`. It recognizes a bounded set of single- and
multi-label public suffixes, reduces a subdomain to the corresponding
registrable business domain, and fails closed for unknown or malformed suffix
shapes. A bounded deny list also excludes common shared tenant/hosting roots.
It is intentionally not a partial or heuristic Public Suffix List, so the
provider/private-suffix lists remain an operational maintenance boundary.

### Review-only evidence and Inbox controls

Two evidence types may be suggested but never applied automatically:

- a completed structured Conversation Intelligence company with confidence of
  at least `0.7` and at least one cited message ordinal; and
- a human-readable company label conservatively formatted from a recognized
  business domain.

A conflicting structured AI company makes an otherwise strong domain
association review-only. The Inbox shows one canonical suggestion with its
source, bounded body-free evidence, **Apply company**, **Dismiss**, and
**Recheck company** controls. Pending submissions disable every mutation
control. Each action re-reads the owner-scoped conversation, current
attachment, blank-company state, candidate, and fingerprint before changing
anything. It returns canonical state and revalidates the affected Inbox and
lead surfaces.

### Persistence, idempotency, and activity

Suggestions are derived from current data rather than stored as a second
company record. Additive migration
`20260729210000_add_company_suggestion_dismissals` adds
`ConversationCompanySuggestionDismissal`. Each dismissal stores the owner,
conversation, attached lead, candidate display value, source, evidence
fingerprint, and dismissal time with owner-composite foreign keys. Its unique
owner/conversation/lead/fingerprint key makes repeated dismissal safe while
allowing materially changed evidence to surface later. Owner, conversation,
or lead deletion cascades related rows.

Apply and automatic detection use serializable transactions, bounded retries,
owner checks, expected attachment/fingerprint checks, and a compare-and-set
company update. Repeated or stale requests cannot overwrite a newer manual
company edit or changed attachment. Dismiss and recheck do not create
`LeadActivity`. Only an actual company change emits the existing
`COMPANY_CHANGED` activity through the existing activity service, with an
evidence-derived idempotency key. There is no new activity type.

## Prior Completed Milestone: Smart Lead Matching

## Existing Foundation Reused

Repository inspection found one existing matching boundary in
`lib/messaging/matching-service.ts`. It already:

- normalizes sender/reply-to email addresses;
- excludes outbound identities and the exact connected mailbox address;
- scopes candidate leads to the conversation owner;
- preserves an existing lead attachment;
- respects `Conversation.manuallyDetached`;
- resolves an existing durable website-submission identity;
- auto-attaches only one exact normalized-email candidate;
- returns an ambiguous result when multiple leads share the email.

The importer calls that service after committing provider-owned conversation
and message data, then applies match state and any attachment in a focused
transaction. This keeps a matching failure from corrupting an otherwise
successful message import. Existing provider, conversation, and message
uniqueness remains the import/retry idempotency foundation.

The extended normalizer deliberately stops treating an entire email domain as
internal. Excluding every same-domain address created false negatives for
customers on shared public domains; only the exact connected mailbox address
and outbound identities are ignored.

## Final Matching Architecture

The existing matching service is the central owner-scoped service for both
Gmail import and Inbox reevaluation. It returns one of three explainable
outcomes:

1. **Automatic match** — one uniquely identified owned lead.
2. **Possible match** — one or more bounded candidates requiring confirmation.
3. **No credible match** — no candidate is attached or implied.

Candidate results contain stable reason codes, body-free human explanations,
confidence categories, matched evidence, and deterministic ranking inputs.
The service returns at most three candidates. Equal candidates use a stable
lead-ID tie-breaker.

### Automatic rules

Automatic attachment requires one owned lead whose normalized email exactly
equals an external inbound sender/reply-to email. A durable website-submission
identity can strengthen and rank a suggestion, but it does not attach a lead
by itself.

Automatic attachment is suppressed when the conversation is already attached
to another lead, manually detached, no longer eligible for automatic review,
or the candidate/evidence fingerprint was dismissed. An import retry cannot
overwrite a user-selected lead or duplicate attachment activity.

### Review-only rules

The following may produce Possible match candidates but never automatic
attachment:

- multiple owned leads sharing the same exact participant email;
- an exact durable website-submission identity without a unique exact
  participant-email match;
- an exact normalized inbound participant display name matching a lead name.

Smart Lead Matching does not use fuzzy name similarity, company similarity,
email-domain inference, message-body contact extraction, or AI inference.
LeadHome has no canonical company-domain identity field, so this milestone does
not invent one.

## Persistence and Migration

The existing `Conversation.matchKind`, `matchReason`, and
`matchCandidateLeadIds` fields cache the latest result. They remain review
state, not a second source of lead identity.

Additive migration `20260729192000_add_smart_lead_match_dismissals` adds
`ConversationLeadMatchDismissal` with:

- `ownerId`, `conversationId`, and candidate `leadId`;
- an `evidenceFingerprint`;
- `dismissedAt`;
- owner-composite conversation and lead relations;
- uniqueness across owner, conversation, lead, and evidence fingerprint;
- owner/conversation and owner/lead lookup indexes.

The migration also adds the `Lead(id, userId)` composite uniqueness needed by
the owner-composite candidate relation. Owner, conversation, or lead deletion
cascades the related dismissal rows. Existing conversations and attachments
are preserved, and no applied migration is rewritten.

When an attached lead is deliberately deleted later, the owner-scoped delete
action resets its conversations to `NEEDS_REVIEW`/`NO_MATCH` and clears the
cached candidate list before deleting the lead, so `SET NULL` cannot leave
stale `MATCHED` review state.

The evidence fingerprint prevents a dismissed candidate from immediately
reappearing for the same identity evidence. Meaningfully changed evidence can
produce a new fingerprint and allow reevaluation. Manual detach remains the
stronger conversation-wide suppression.

## Inbox and Existing Conversations

Unattached conversations with credible candidates show a compact Possible
match state. Conversation detail presents a bounded ordered list with lead
name, optional company/email context, confidence, concise reasons, an inspect
link, explicit Attach action, the existing Choose another lead workflow, and
Dismiss.

Confirmation and dismissal are authenticated, owner-scoped mutations. A
client-supplied candidate ID cannot attach or dismiss another owner's lead.
Pending and error states stay local to the existing Inbox review surface.

Existing conversations use an explicit authenticated **Recheck matches**
action. It
loads one owned conversation and at most 100 identity-only inbound messages,
then applies the same central matcher. The detail page may calculate a bounded
read-only current view, but rendering never persists state. There is no
unbounded owner scan and no new background job type for matching.

## Import and Activity Behavior

Gmail import continues to:

- normalize through the provider adapter;
- preserve provider-owned versus user-owned fields;
- commit one conversation and its returned messages atomically;
- evaluate matching after message persistence;
- apply cached match state and any eligible attachment in a focused
  owner-scoped transaction;
- preserve message, attachment, and activity idempotency on retry.

Smart Lead Matching continues to use `LeadActivity` and
`lib/activity-service.ts`. A confirmed automatic attachment records one
idempotent system/Gmail link event. A user-approved suggestion uses the
existing manual attachment service and records the existing Inbox link event.
Candidate calculation, display, ranking changes, **Recheck matches** with no
relationship change, and dismissal do not create activity.

Website ingestion remains unchanged: it creates the canonical lead and durable
submission identity. The matching service consumes that identity where a
message already carries it; it does not add a redundant website matching flow.

## Owner Isolation and Safety

- Every candidate query includes the authenticated owner.
- Conversation, candidate lead, dismissal, confirmation, and Recheck
  relationships are owner-validated server-side.
- Dismissal relations use owner-composite foreign keys.
- Candidate lists and identity-message reads are bounded.
- Stable reasons never contain message bodies, private notes, provider
  payloads, tokens, or OAuth data.
- Manual attachment and detach decisions override automated results.
- Calculating suggestions cannot mutate another owner's data or reveal that
  another owner's matching lead exists.

## Production Gmail and Cron Reconciliation

Production infrastructure is now verified independently of this milestone:

- Custom Gmail mailbox authorization starts at `/api/gmail/connect` and
  returns to `/api/gmail/callback`.
- Auth.js Google account login/linking returns to
  `/api/auth/callback/google`; it does not share the Gmail callback.
- Gmail Connect/Reconnect controls are ordinary server-rendered anchors, not
  prefetched Next.js links or hydration-dependent buttons.
- Production Gmail authorization and encrypted token persistence succeeded.
- A production Gmail sync was queued, invoked with Vercel's Cron dashboard
  **Run** control, completed, and imported conversations/messages visible in
  the Inbox.
- `vercel.json` currently uses the Hobby-compatible `0 10 * * *` schedule:
  once daily at 10:00 UTC.
- Once-per-minute automatic draining is a future Vercel Pro configuration, not
  the current production cadence.

Vercel Cron remains a trigger for the same durable PostgreSQL queue. Execution
is at-least-once; database claims, leases, retries, stale recovery, and handler
idempotency remain required. The schedule drains jobs already enqueued by the
application and does not itself enqueue periodic Gmail syncs.

## Prior Completed Milestone: Unified Activity Timeline

Unified Activity Timeline extended the existing `LeadActivity` model and added
`lib/activity-service.ts` as the single owner-validating recorder/query
boundary. Migrations `20260727230000_unified_activity_timeline` and
`20260727231500_correct_unified_activity_provenance` added typed actor/source,
business `occurredAt`, owner-scoped idempotency, optional durable relations,
stable cursor ordering, and best-effort legacy provenance correction without
fabricating history.

The completed milestone integrated meaningful lead, website, conversation,
Gmail, task, pipeline, and Conversation Intelligence events; added the
server-rendered paginated lead timeline and Dashboard Recent Activity; and kept
low-level sync/no-op state out of business history. Later stabilization fixed
persisted follow-up rendering, split timeline pagination into a small client
island, disabled the faulty development React debug channel, aligned Node with
Vercel 24.x, and removed the polling worker's accumulated abort listeners.

## Verification

The prior Smart Lead Matching verification, including manual-detach recovery
and canonical presentation stabilization, passed on Node 24.18.0:

- the stabilization set passed 8 focused files / 80 tests across matching,
  recovery, canonical presentation, Inbox actions/UI, manual detach, Gmail
  normalization/import, and the Gmail job handler;
- the full suite passed 79 files / 441 tests, with only the explicitly gated
  OpenAI smoke test skipped;
- Prisma format, validate, and normal client generation passed;
- migration `20260729192000_add_smart_lead_match_dismissals` deployed
  successfully, and Prisma reports all 18 migrations applied;
- TypeScript, ESLint, the production Next.js build, and `git diff --check`
  passed.

Provider regressions used fixtures/mocks; no real mailbox data or provider
credentials entered automated tests.

Automatic Company Detection has focused coverage for domain and participant
normalization, automatic eligibility and suppression, structured-analysis and
domain-only suggestions, conflicts, bounded association queries, owner
isolation, concurrent edits and attachment changes, dismissal/recheck
idempotency, canonical actions/presentation, all attachment triggers,
post-analysis detection, activity behavior, and migration/schema invariants.
Before the final Gmail durable-job handoff was added, the focused set passed 17
files / 193 tests and the full suite passed 85 files / 524 tests on Node
24.18.0; the separately gated OpenAI smoke test remained skipped (86 files /
525 tests including that skip). On the complete implementation, Prisma
format/validate/generate, TypeScript, full ESLint, and `git diff --check`
passed. The newly added enqueue/handler/runner tests, complete full suite, and
Node 24 production build remain the final verification gate.

## Known Limitations

- Matching is deterministic and intentionally conservative; it is not fuzzy or
  AI-powered.
- Name-only evidence requires review and can produce false-positive candidates
  when contacts share a display name.
- Candidate results are capped at three, so a heavily duplicated identity may
  require the existing manual lead chooser.
- `Lead.company` is a text field rather than a canonical company/domain entity.
  Detection recognizes only an explicit bounded suffix/provider set and fails
  closed outside it; it does not perform fuzzy company resolution.
- Existing conversations are reevaluated one at a time through
  **Recheck matches** and **Recheck company**; there is no bulk backfill scan,
  matching job, or company-detection job.
- Contact Extraction is not an applied CRM workflow.
- Gmail remains read-only and has no scheduled periodic enqueue. The current
  queue drainer runs daily unless an operator uses Vercel's **Run** control.
- Cron/function execution is at-least-once and production queue-stall alerting
  is not implemented.

## Next Recommended Milestone

Contact Extraction is the next roadmap item. It should remain a reviewed,
evidence-backed workflow and must not weaken the unique-identity boundary used
for automatic lead attachment or the conservative company-application
boundary.
