# Production Inbox

`/inbox` uses two independent server queries:

1. The list query returns 25 conversation summary DTOs and one lookahead row.
   It selects one narrow latest-message record for the preview and never loads
   full threads or HTML bodies.
2. The detail query runs only when `conversation=<id>` is present and loads
   messages for that owner-scoped conversation in chronological order.

Search, filters, pagination, and selection are URL-backed. Search covers
subject, sender, and attached lead name/email; message bodies are deliberately
excluded.

Pagination currently uses an offset (`page=`) because it keeps combined filters
and browser navigation straightforward. Queries use stable
`lastMessageAt DESC NULLS LAST, id DESC` ordering. The importer advances
`lastMessageAt` only when the greatest known message timestamp is newer, so an
out-of-order or retried import cannot move a conversation backward. The list
falls back to the selected newest message timestamp for display if the summary
timestamp is unexpectedly null; a conversation with no messages shows
`No message date`. Cursor pagination should replace offset pagination if
deep-page database measurements show scanning to be material.

The unified activity history records one conversation-import event, link and
unlink events, meaningful linked-conversation status changes, and body-free
events for messages first observed after the initial import baseline. Lead
timeline links return to the selected Inbox conversation.

Smart Lead Matching extends the existing review workflow without silently
attaching uncertain candidates. Only one unique exact normalized participant
email may attach automatically. Durable website-submission identity,
ambiguous exact-email matches, and exact normalized display-name matches are
shown as explainable possible matches and require an explicit choice. The
detail view presents at most three deterministically ordered candidates with
stable reason codes, lead context, inspect/attach controls, the existing
choose-another-lead flow, and a dismiss action. Inbox rows can show a compact
Possible match state without expanding the list query.

The latest result is cached in the existing conversation match fields. An
explicit authenticated, owner-scoped Recheck action evaluates only the
selected conversation and at most 100 identity-only inbound messages, so
conversations imported before this feature can be reconsidered without an
unbounded owner scan. The detail page may compute a bounded read-only current
view, but rendering does not persist match state. A manual attachment always
wins, a manual detach blocks automatic reattachment, and dismissing a candidate
suppresses the same candidate/evidence fingerprint until meaningful identity
evidence changes.

Candidate calculation, display, reordering, dismissal, and no-match results do
not create activity; confirmed automatic and user-approved attachments
continue through the existing attachment and activity services.

In development, bounded query timing and row/message counts are logged on the
server. `/dev/messages` remains unavailable in production and now shows only
the newest 20 diagnostic summaries.
