# Phase 2 Progress

## Current Milestone

Smart Lead Matching is the active Phase 2 milestone. It extends the existing
conservative exact-email matcher into one explainable automatic/suggested
matching workflow without adding a competing matcher, matching queue, activity
table, or AI dependency.

The implementation is intentionally incremental:

- one unique exact normalized participant email may attach automatically;
- credible but ambiguous evidence is shown for review;
- weak, fuzzy, body-derived, company-inferred, or AI evidence never attaches a
  lead;
- manual decisions always override automation.

## Milestone Status

**Complete.**

The implementation, additive migration, focused/full tests, Prisma checks,
TypeScript, ESLint, Node 24 production build, migration status, and
`git diff --check` all passed on the complete working tree.

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

Automatic Company Detection and Contact Extraction remain separate future
milestones. Conversation Intelligence may display suggestions, but Smart Lead
Matching does not apply AI output to lead identity.

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

Existing conversations use an explicit authenticated **Recheck** action. It
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
Candidate calculation, display, ranking changes, Recheck with no relationship
change, and dismissal do not create activity.

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

Final verification, including the manual-detach recovery and canonical
presentation stabilization, passed on Node 24.18.0:

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

## Known Limitations

- Matching is deterministic and intentionally conservative; it is not fuzzy or
  AI-powered.
- Name-only evidence requires review and can produce false-positive candidates
  when contacts share a display name.
- Candidate results are capped at three, so a heavily duplicated identity may
  require the existing manual lead chooser.
- There is no canonical company-domain model, automatic company detection, or
  contact extraction.
- Existing conversations are reevaluated one at a time through Recheck; there
  is no bulk backfill scan or matching job.
- Gmail remains read-only and has no scheduled periodic enqueue. The current
  queue drainer runs daily unless an operator uses Vercel's **Run** control.
- Cron/function execution is at-least-once and production queue-stall alerting
  is not implemented.

## Next Recommended Milestone

After Smart Lead Matching passes final verification, Automatic Company
Detection is the next roadmap item. It should remain a reviewed, explainable
workflow and must not weaken the unique-identity boundary used for automatic
lead attachment. Contact Extraction should remain a separate later milestone.
