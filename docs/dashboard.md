# Dashboard Needs Attention

The dashboard is a server-rendered daily work surface. Its primary question is:
"If I only have one hour today, what should I work on first?" It derives current
attention from canonical lead, task, conversation, message, matching, and
company-detection state. It does not persist attention records or call AI.

## Information hierarchy

The dashboard renders three sections in this order:

1. **Needs Attention** is the dominant ranked queue. Nonzero categories appear
   as structured action rows with a count, concrete explanation, severity, and
   bookmarkable destination.
2. **Today's Work** contains at most eight direct record links sampled from the
   attention queues. It is a shortlist rather than a duplicate Inbox, Leads, or
   Tasks page.
3. **Business Health** keeps pipeline value, active opportunities, wins this
   week, new-stage lead volume, pipeline distribution, and five recent
   meaningful activities below the work surfaces.

The former Recent Leads, Due Today, Overdue Tasks, and Upcoming Tasks dashboard
cards were removed. Actionable lead and task records now appear in Today's
Work; complete lists remain on their owner-scoped destination pages. Recent
Activity remains as the smaller **What changed** rail.

## Deterministic categories and order

`lib/dashboard/attention.ts` owns category rules, ordering, counts, bounded
samples, and destination URLs. Categories are always ordered as follows.

### 1. Customers waiting for a reply

Included conversations:

- belong to the current owner and are attached to that owner's lead;
- are `OPEN` and are neither `IGNORED` nor `RESOLVED`;
- are conservatively classified as `LEAD` or `CUSTOMER`; and
- have an inbound latest stored message when messages are ordered by
  `receivedAt DESC, id DESC`.

A later outbound message therefore removes the conversation. Outbound-only,
newsletter, spam, system, internal, unknown-classification, closed, archived,
ignored, resolved, unattached, and other-owner conversations are excluded.
Message direction continues to come from provider normalization and connected
mailbox identity handling; the dashboard does not reinterpret addresses.

Destination: `/inbox?attention=awaiting-response`.

### 2. Follow-ups and tasks overdue

Included work is an owner-scoped `OPEN` task whose non-null `dueAt` is earlier
than the same request-time `now` used by the Tasks service. Completed,
cancelled, undated, and future tasks are excluded. Follow-up tasks remain the
canonical source for `Lead.nextFollowUpDate`; the dashboard does not calculate
a second follow-up state. Today's Work may additionally show open tasks due
later today, while the attention count remains overdue-only.

Destination: `/tasks?view=overdue`.

### 3. New leads not yet contacted

Included leads:

- belong to the current owner;
- remain in the `NEW` pipeline stage;
- have no outbound message on an attached owned conversation; and
- have no owner-scoped `MESSAGE_SENT` activity.

Contacted and later-stage leads, including won and lost leads, are excluded by
the `NEW` requirement. Deleted leads cannot be returned. No arbitrary creation
grace period was added because LeadHome has no existing canonical grace rule.

Destination: `/leads?attention=untouched`.

### 4. Lead matches need review

Included conversations are owner-scoped, unattached, not manually detached,
`OPEN`, `NEEDS_REVIEW`, and have canonical persisted `matchKind=AMBIGUOUS`.
Automatic or manual attachments, final dismissal state, manual-detach blocks,
resolved review state, and other-owner matches are excluded by the existing
matching mutation state.

Destination: `/inbox?attention=match-review`.

### 5. Company suggestions need approval

Potential conversations must be owner-scoped, open, active in review, attached
to an owned lead, and have a null company. Up to 100 recent candidates are
passed through the existing canonical company-detection service with database
concurrency limited to five. Only views returning the current `SUGGESTED`
state count. This automatically respects current attachment, populated
company, evidence fingerprints, and dismissals without duplicating company
rules.

The displayed count has a `+` suffix when more than 100 candidates exist or a
candidate evaluation fails, making it an explicit lower bound. This bounded
tradeoff avoids an unbounded dashboard scan while preserving canonical results
for every displayed record.

Destination: `/inbox?attention=company-review`.

Operational job failures are not a dashboard category. Current job errors are
not consistently user-resolvable, and exposing them would mix operator state
with daily CRM work.

## Query bounds and indexing

- Today's Work returns at most eight records.
- Per-category dashboard samples use at most four source rows; at most two of
  a category enter the final shortlist.
- Inbox attention ID sets are capped at 500 records.
- Company review evaluates at most 100 candidate conversations with concurrency
  five.
- Recent Activity is capped at five meaningful events.
- Every query includes the authenticated owner boundary.

Migration `20260731210000_add_message_conversation_time_index` adds
`Message(conversationId, receivedAt, id)`. It supports the latest-message
lateral lookup and existing conversation message ordering without modifying
message history.

## URL filters

Inbox accepts `attention=awaiting-response`, `attention=match-review`, or
`attention=company-review`. Leads accepts `attention=untouched`. Invalid values
fall back to the normal owner-scoped page. Filters remain compatible with
existing search, status, classification, sorting, and pagination parameters;
the pages announce the active attention filter and preserve it in form and
pagination URLs. Tasks reuse the existing `view=overdue` filter.

## Empty and failure behavior

When every category count is zero, the dashboard says the user is caught up
and does not invent advice. The dashboard streams an announced loading state.
Attention, business-health, and recent-activity failures are isolated: an
attention failure offers direct Inbox/Leads/Tasks links, while secondary
failure messages do not blank the work surface.

## Deferred work

This milestone does not add AI prioritization, buying-signal detection,
free-text follow-up detection, notifications, automation rules, polling, or
customizable widgets. Awaiting-response classification is intentionally
conservative and excludes `UNKNOWN` conversations until a user or existing
workflow classifies them as a lead or customer.
