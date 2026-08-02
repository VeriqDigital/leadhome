# Reviewed Contact Extraction

Reviewed Contact Extraction turns existing Inbox evidence into explicit,
owner-approved updates to an attached lead's name, email, or phone. It is a
review workflow, not an enrichment job: rendering, rechecking, and dismissing
suggestions never change a lead, and no contact value is applied without a
user action.

## Scope and canonical boundary

`lib/messaging/contact-extraction-service.ts` is the only extraction,
relevance, dismissal, and application boundary. It reads current
owner-scoped Inbox state and derives at most one suggestion for each supported
Lead field:

- `Lead.name`
- `Lead.email`
- `Lead.phone`

It does not add a contact entity or support company, job title, website,
address, social profile, or alternate-contact fields. Company continues to be
owned by Automatic Company Detection.

The service uses persisted data only. It does not call Gmail or OpenAI, queue
a job, parse model prose, or persist an active suggestion cache. Gmail import
therefore remains independent of contact review.

## Evidence and precedence

The service considers two canonical sources:

1. A credible external sender on a stored inbound message. Exactly one
   external sender identity may supply a deterministic email and a readable,
   non-generic display name.
2. The contact object in the current canonical `ConversationAnalysis`. These
   values remain AI-derived suggestions even though they passed the strict
   structured-output boundary.

Deterministic sender metadata wins when both sources contain the same
normalized value. Ambiguity is resolved per field: different values suppress
only that field rather than every contact suggestion. A sender display name
that conflicts with an explicit analyzed body/signature name therefore
suppresses `Lead.name`, while a unique external sender address remains an
independent email candidate and a unique validated analyzed phone remains an
independent phone candidate. Multiple external sender addresses suppress both
sender name and email because the service cannot safely associate either one
with the primary contact.

Sender evaluation ignores recipients, reply-to identities, outbound-only
messages, malformed or non-public addresses, system-only addresses, and every
bounded mailbox identity known for the owner. It never constructs a name from
an email local part. Generic display labels such as support, sales, info,
billing, notifications, no-reply, customer service, account verification,
team, and admin are excluded.

Phone values come only from validated structured analysis evidence. They may
contain ordinary readable phone punctuation and must contain 7 through 15
digits. Comparison removes formatting while preserving an evidenced leading
`+`; display and application preserve the bounded readable value. The service
does not infer a country code.

## Conversation Intelligence freshness

AI-derived candidates are available only when Conversation Intelligence is
enabled and the canonical analysis is complete, schema-valid, on the current
analysis version, backed by a content hash and completion time, and cites at
least one validated message ordinal. Its persisted source-message count must
also equal the conversation's current message count. This bounded, body-free
check prevents retained or superseded analysis output from becoming an
applicable contact suggestion.

The extractor also reads the analysis lifecycle and its latest owner-scoped
job. `QUEUED`/`RUNNING` analysis or a `PENDING`, `RUNNING`, or
`RETRY_SCHEDULED` latest job produces a canonical `REFRESHING` view. Retained
structured output is ignored in that state. A unique external sender email
may remain visible as independently deterministic evidence, but its actions
and the provisional sender display name are withheld until analysis finishes.
If no deterministic evidence remains, the panel says that contact details
will refresh after analysis completes instead of disappearing.

When Conversation Intelligence is disabled or its output is stale,
deterministic sender email/name suggestions can still appear. The contact
panel does not enable Intelligence or imply that analysis ran.

## Relevance and conflict presentation

The selected Inbox conversation must still be attached to the same owned
lead. Unattached, deleted, wrong-owner, or reassigned conversations produce no
mutation suggestions.

A normalized candidate equal to the current lead value is hidden. A candidate
for a blank nullable field is non-conflicting and uses **Apply**. A different
candidate for a populated field uses explicit **Replace current value**
wording and is never included in bulk application. Because `Lead.name` is
required, a different suggested name is always an explicit replacement.

The Inbox panel shows the field, current value, suggested value, and a concise
source explanation. It sends no message bodies, raw analysis JSON, provider
payloads, hidden prompts, or internal confidence values to the browser. No
Dashboard Needs Attention category or Inbox-row badge is added for this
milestone.

After an application, the suggestion disappears and feedback shows the
canonical value now stored on the lead. A newer server-rendered extraction
view always supersedes an older action result, so Gmail sync, manual edits, or
reanalysis cannot remain masked in the selected conversation.

If completed evidence is ambiguous, the panel remains present with
"Conflicting contact identity detected. Confirm the contact manually."
Unambiguous fields continue to render and remain actionable; an
explanation-only panel remains when none do.

## Application and concurrency

Every Apply, Replace, Apply available fields, Dismiss, Dismiss all, and Recheck
request authenticates the user and reconstructs the canonical result on the
server. The browser submits only bounded identifiers, a closed contact field,
and opaque server-issued fingerprints; it never supplies the candidate value,
source, or owner.

Evidence fingerprints identify a normalized candidate and its material
provenance. Separate review fingerprints also bind a displayed suggestion to
the lead field value and canonical analysis/job generation used during
rendering. Mutations recompute both inside a serializable transaction and
verify current owner, attachment, lead, evidence, analysis lifecycle, and
field state before writing. Apply and Dismiss are rejected as stale while
reanalysis is active, before any lead, activity, or dismissal write.

An individual Apply is valid only while its field remains blank and the
review token is current. Replace is valid only for the exact populated value
that was reviewed. A compare-and-set update changes only approved contact
fields, so a newer manual edit, detach, reassignment, reanalysis, or changed
sender cannot be overwritten.

**Apply available fields** considers at most the three displayed suggestions
and applies only still-current, non-conflicting blank fields in one
owner-scoped transaction. Conflicts are skipped rather than replaced. A
concurrent change returns a clear partial or stale result and remains
canonical after refresh.

Repeated and concurrent requests are idempotent. Applying a value that is
already current is a harmless no-op; only the transaction that actually
changes the lead records activity.

An ordinary successful mutation derives its canonical post-write view from
the one bounded evidence evaluation already performed in that transaction;
it does not reload or reparse the complete analysis. A rare compare-and-set
loss may perform one fresh evaluation so the caller receives current state.

## Dismissal persistence

The additive `ConversationContactSuggestionDismissal` model stores one review
decision scoped to:

- owner
- conversation
- currently attached lead
- contact field
- SHA-256 candidate hash
- evidence fingerprint

It does not store the candidate value, message content, analysis output, or
provider data. Owner-composite conversation and lead relationships prevent
cross-owner references and cascade on owner, conversation, or lead deletion.
Repeated dismissal uses the same unique decision and is harmless.

Dismissals survive refresh, navigation, recheck, unrelated Gmail sync, and
same-evidence analysis reads. A materially different candidate, analysis
version/evidence ordinals, or sender identity receives a different fingerprint
and may be reviewed later. A content-hash-only change does not invalidate an
otherwise identical contact decision. Recheck derives current state only; it
does not delete decisions, enqueue analysis, mutate a lead, or create activity.

## Activity and bounds

Only an actual approved lead update emits activity. Existing
`buildLeadUpdateActivities` semantics group simultaneous name, email, and
phone changes into one `CONTACT_INFO_CHANGED` event. The event is attributed
to the user, sourced from Inbox, linked to the current conversation, and uses
an idempotency key derived from the approved evidence and prior lead state.
Suggestion reads, ambiguity, dismissals, rechecks, stale requests, and no-op
applications create no activity.

Evaluation loads one selected owner-scoped conversation, at most 100 recent
inbound message metadata rows, at most 20 owned mailbox addresses, the one
canonical analysis and latest job status, and at most three matching dismissal
decisions. When the
message window is full, one owner-scoped query selects only a possible 101st
inbound message ID to prove whether the identity window is complete; overflow
fails closed for name/email identity. Mailbox-address overflow does the same.
Independent validated phone evidence can remain reviewable. No
email body or HTML is needed for contact review, and the result contains at
most three field suggestions.

## Deferred behavior

This milestone deliberately defers multi-contact records, alternate emails or
phones, job title, website, postal address, social profiles, external
enrichment, signature parsing, contact-specific background jobs, automatic
application, Inbox prioritization, and automation rules.
