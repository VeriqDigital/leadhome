# Tasks and follow-ups

Tasks are LeadHome's canonical action and reminder records. There is no separate
Reminder model. `/tasks` is the management surface and `/reminders` redirects to
`/tasks?view=upcoming`.

## Domain

Every task is owned by one user. Lead and conversation links are optional and
are validated against that owner before writes. Deleting a linked lead or
conversation preserves the task and sets the corresponding relation to null.
Deleting the owning user cascades their tasks.

Types are `GENERAL`, `CALL`, `EMAIL`, `MEETING`, and `FOLLOW_UP`. Priorities are
`LOW`, `NORMAL`, `HIGH`, and `URGENT`. Statuses are `OPEN`, `COMPLETED`, and
`CANCELLED`. Completing sets `completedAt`; reopening clears it. Repeating an
already-applied transition is a no-op.

Date-only tasks are submitted as `YYYY-MM-DD` and stored at local noon to
preserve their calendar day. Date-and-time inputs are converted to ISO by the
browser before submission and stored as timestamps. Display formatting uses the
browser timezone. An open task with `dueAt` before the current time is overdue.

## Follow-up summary

`Task` is the source of truth for follow-up work. `Lead.nextFollowUpDate` remains
a query-friendly summary and equals the earliest non-null due date among that
lead's open `FOLLOW_UP` tasks. Task creation, editing, movement, completion,
reopening, cancellation, and deletion recalculate affected leads
transactionally. Other task types do not change the summary.

## Activity and dashboard behavior

Lead-linked task mutations write safe summary activities without copying task
notes. Conversation-only tasks do not create invalid lead activity. Deletion
preserves a historical task-deleted activity before removing the operational
record.

The Dashboard uses bounded owner-scoped queries: up to five overdue tasks, five
due-today tasks, and five upcoming tasks. "Needs Follow-up" counts distinct
leads whose summarized next follow-up is due by the end of the current local
day. Dashboard completion uses the same transactional task service.

## Inbox workflows

An Inbox conversation can prefill an editable follow-up task without attaching
the conversation. An unattached conversation can also open a deliberate
create-lead review form. The form uses the first inbound participant, a short
plain-text message excerpt, and a provider-derived source. Exact owned-lead
email matches require choosing between attaching the existing lead, creating a
separate lead, or cancelling. Creation and attachment occur in one transaction
and never alter message history.

This phase does not add AI task creation, automatic lead or task creation,
email sending, Gmail modification, background synchronization, calendar
integration, browser notifications, pipeline drag-and-drop, teams, or billing.
