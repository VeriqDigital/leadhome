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
`lastMessageAt DESC, id DESC` ordering. Cursor pagination should replace it if
deep-page database measurements show offset scanning to be material.

In development, bounded query timing and row/message counts are logged on the
server. `/dev/messages` remains unavailable in production and now shows only
the newest 20 diagnostic summaries.
