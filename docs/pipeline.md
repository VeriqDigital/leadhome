# Pipeline board

`/pipeline` is a server-rendered, owner-scoped board. The route parses URL filters
and sorting, and `lib/pipeline/pipeline-query.ts` performs one bounded card query
per stage plus bounded aggregate queries. It never sends message bodies, notes,
or full activity histories to the browser.

Each column initially returns 20 cards and can be expanded through a URL-backed
per-column limit up to 100. A card includes identity, company, source, estimated
value, next follow-up, the latest activity time, `updatedAt`, whether a
conversation is attached, and bounded open-task summary data. Task details are
limited to 50 open tasks per displayed lead; cards expose overdue/today counts,
the next open task date, and whether an open follow-up task exists.

The default order is follow-up urgency: overdue, today, upcoming, then no
follow-up, followed by newest `updatedAt` and a stable ID tie-breaker. Alternate
URL-backed sorts are recently updated, highest/lowest value (null last), and
name A-Z/Z-A. Filters cover search, source, value range, follow-up state, open
tasks, and attached conversations.

## Metrics

- Active opportunity count: all owned leads except `WON` and `LOST`.
- Active pipeline value: estimated value for those active leads; null is $0.
- Overdue follow-ups: active owned leads with a non-null follow-up before now.
- Won value this week: value of owned `WON` leads updated since the local start
  of the current week; null is $0.

These definitions match the Dashboard's active pipeline and won-this-week
semantics. Stage transitions revalidate both routes.

## Interaction and persistence

Desktop cards have mouse drag handles. Pointer events provide touch movement,
and every card has a labeled stage selector as the keyboard/mobile fallback.
Mobile shows one selected stage at a time. Moves optimistically adjust cards,
counts, and values, block duplicate requests, announce progress, and restore the
exact prior board snapshot if persistence fails.

All entry points use the same transactional status service. It authenticates and
owner-scopes the lead, validates the stage, performs a compare-and-update,
creates exactly one `STATUS_CHANGED` activity, and rereads canonical state.
Same-stage moves are no-ops. Won and lost leads can be reopened. No stage change
deletes history, conversations, or tasks.

Entering Follow-up does not invent a date or task. A card without an open
follow-up task shows a non-blocking link to the existing task creation page.

## Indexes

Migration `20260727170000_add_pipeline_indexes` adds focused composite indexes
for owner/status with follow-up urgency, recent updates, and estimated-value
sorting. The migration is additive and does not modify earlier migrations.

## Intentionally deferred

AI, email sending, proposal documents, automatic task creation, automatic lead
creation, billing, teams, additional external providers, and advanced
forecasting are outside this phase.
