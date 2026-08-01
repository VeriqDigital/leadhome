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
browser before submission and stored as timestamps. Task due labels are
server-rendered so persisted dates do not produce server/client hydration
differences. An open task with `dueAt` before the current time is overdue.

## Follow-up summary

`Task` is the source of truth for follow-up work. `Lead.nextFollowUpDate` remains
a query-friendly summary and equals the earliest non-null due date among that
lead's open `FOLLOW_UP` tasks. Task creation, editing, movement, completion,
reopening, cancellation, and deletion recalculate affected leads
transactionally. Other task types do not change the summary.

On the lead detail page, "Next follow-up" is a read-only view of that derived
summary. A successful task mutation completes its transaction before the
literal `/leads/<id>` route is revalidated once. The server-rendered task list
and timeline therefore return with the new data. The lead form keeps local
state only for editable CRM values and composes "Next follow-up" directly from
the current server prop. A revalidated result updates that read-only field
immediately while preserving unsaved edits, without a synchronization effect,
render-time state update, repeated refresh, poll, navigation, or write.

Lead edits ignore the submitted read-only follow-up value, including stale or
tampered values. Only task recalculation can update `Lead.nextFollowUpDate`.

After a successful task creation, the form remounts its field group using the
created task ID. Title, priority, due date/time, conversation, notes, status,
and one-use AI provenance are cleared so a second task can be submitted
immediately. A lead-detail follow-up form deliberately preserves its initial
lead ID and `FOLLOW_UP` type across that reset; the next task therefore remains
linked to the lead and still participates in follow-up recalculation. Starting
new input acknowledges and clears the previous success message.

## Activity and dashboard behavior

Task creation, meaningful edits, completion, reopening, cancellation, and
deletion write safe summary activities without copying task notes. Activities
use typed task, lead, and conversation links when those relationships exist;
standalone and conversation-only tasks are valid activity subjects. Deletion
records the event before removing the operational task, after which the
activity's task relation becomes null and its history remains.

Follow-up recalculation records a separate system activity when it changes a
lead's summarized next follow-up. Both the task mutation and summary update
remain in the same transaction. Repeating a no-op transition does not add
another task or activity record and does not trigger route revalidation.

The Dashboard's **Follow-ups and tasks overdue** count and the bookmarkable
`/tasks?view=overdue` destination share the task service's canonical view
predicate: owner-scoped `OPEN` tasks with a non-null `dueAt` earlier than the
same request-time `now`. Completed, cancelled, undated, current, and future
tasks are excluded. The Tasks page announces that active view. Today's Work
may sample up to two open tasks due before the end of the current local day,
with overdue records first; task writes still use the same transactional
service.

## Inbox workflows

An Inbox conversation can prefill an editable follow-up task without attaching
the conversation. An unattached conversation can also open a deliberate
create-lead review form. The form uses the first inbound participant, a short
plain-text message excerpt, and a provider-derived source. Exact owned-lead
email matches require choosing between attaching the existing lead, creating a
separate lead, or cancelling. Creation and attachment occur in one transaction
and never alter message history.

Conversation Intelligence suggestions can prefill the normal task form. The
service revalidates the owned analysis and suggestion when the user explicitly
saves, then records that the task came from an AI suggestion. AI never creates
a task automatically.

Email sending, Gmail modification, calendar integration, browser
notifications, autonomous lead or task creation, teams, and billing remain
outside the current task feature.
