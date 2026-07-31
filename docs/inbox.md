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
explicit authenticated, owner-scoped **Recheck matches** action evaluates only the
selected conversation and at most 100 identity-only inbound messages, so
conversations imported before this feature can be reconsidered without an
unbounded owner scan. The detail page may compute a bounded read-only current
view, but rendering does not persist match state. The top summary, suggestion
panel, and selected row badge are derived from that same server result so a
fresh suggestion cannot contradict a stale cached label. Matching mutations
return the bounded canonical persisted state, revalidate the Inbox, and refresh
the server-rendered view.

A manual attachment always wins, and a manual detach continues to block
automatic reattachment. A manually detached, unattached conversation shows an
explicit **Allow matching again** control. The owner-scoped action clears only
the detach suppression and cached match result, restores normal review, and
immediately calls the existing centralized matcher. Repeated or concurrent
requests cannot overwrite a newer attachment. Clearing the block or
recalculating suggestions creates no activity; an actual unique-email
automatic attachment continues through the existing idempotent activity and
Conversation Intelligence enqueue behavior. Existing dismissal fingerprints
remain in force.

Dismissing a candidate suppresses the same candidate/evidence fingerprint
until meaningful identity evidence changes.

Candidate calculation, display, reordering, dismissal, and no-match results do
not create activity; confirmed automatic and user-approved attachments
continue through the existing attachment and activity services.

Automatic Company Detection begins only after a conversation is attached to
an owned lead. It is separate from Smart Lead Matching and does not affect
which lead is selected. `Lead.company` remains the only company
representation; there is no `Company` entity or parallel persisted company
result. One centralized, database-only service runs after the four existing
attachment service paths and after a completed Conversation Intelligence
analysis. It does not add another model call. Interactive and Fake-provider
attachments evaluate immediately; a Gmail-imported automatic attachment
enqueues one idempotent `COMPANY_DETECTION` job on the existing queue. The
queued handler rechecks canonical ownership, attachment, evidence, and company
state, so it cannot overwrite a later manual decision and does not extend the
Gmail import.

Automatic application is intentionally narrow. The attached lead must still
belong to the owner and have a blank company, and the conversation must have a
credible external inbound identity that resolves to exactly one recognized
business domain. Other owned leads on that domain must map to exactly one
normalized nonblank company without exceeding the bounded association query.
A conflict with a structured AI company suggestion, a current dismissal,
attachment change, company edit, ambiguous domain, or conflicting association
prevents the automatic write.

Public mailbox, disposable, relay, malformed, system-only, connected-mailbox,
and outbound identities are excluded. Recipient-only addresses unrelated to
the inbound sender/reply-to identity are not evidence. Subdomains are reduced
only through a conservative explicit suffix utility that fails closed for
unknown suffix shapes and known shared tenant roots. All bounded stored
mailbox addresses for the owner are excluded; detection fails closed if that
owner-mailbox lookup overflows.

Two weaker sources remain review-only: a formatted business-domain label and a
structured AI company with at least `0.7` confidence and cited message
evidence. The owner-scoped suggestion panel uses canonical server state and
supports **Apply company**, **Dismiss**, evidence inspection, and
**Recheck company** with disabled pending controls. Dismissals are scoped to
the current owner, conversation, attached lead, candidate source, and evidence
fingerprint, so unchanged evidence stays suppressed while materially changed
evidence may be reconsidered. Apply, dismiss, and recheck re-read current
attachment and company state; stale or repeated requests cannot overwrite a
manual edit or create duplicate activity. Only an actual `Lead.company`
change emits the existing `COMPANY_CHANGED` event.

In development, bounded query timing and row/message counts are logged on the
server. `/dev/messages` remains unavailable in production and now shows only
the newest 20 diagnostic summaries.
