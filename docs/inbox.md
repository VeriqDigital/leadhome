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

In development, bounded query timing and row/message counts are logged on the
server. `/dev/messages` remains unavailable in production and now shows only
the newest 20 diagnostic summaries.
