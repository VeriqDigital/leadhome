# Messaging import architecture

LeadHome treats provider adapters as normalization boundaries. Adapters return
`NormalizedProviderAccount`, `NormalizedConversation`, and
`NormalizedMessage`; the importer does not consume Gmail- or fixture-specific
payloads. Gmail and the development fixture provider are implemented. The
schema reserves other provider values, but there is no Outlook adapter.

## Field ownership

Provider-owned fields are provider IDs, account display data, conversation
subject and metadata, message contents and threading identifiers, and the
latest-message timestamp. These fields may be refreshed during import.

User-owned fields are `leadId`, conversation lifecycle state after creation,
classification after creation, review state, and manual-detach intent. Imports
do not overwrite them. A manual detach is durable and prevents a later exact
email match from silently reattaching the conversation.

## Idempotency and transactions

Accounts are unique by owner, provider, and provider account ID. Conversations
are unique within an account; messages are unique within an account. Provider
calls finish before focused database transactions begin. Each conversation and
its currently returned messages are then imported atomically with
`skipDuplicates`, so retries, arbitrary order, and overlapping imports remain
safe.

## Matching

`lib/messaging/matching-service.ts` is the single owner-scoped matching
boundary used by the importer and Inbox reevaluation. It reuses the existing
email normalization and durable website-submission lookup rather than adding a
second exact-email matcher.

Automatic attachment remains deliberately narrow. An existing attachment
wins. Otherwise, exactly one owned lead whose normalized email equals an
external inbound sender/reply-to email may attach automatically. Durable
website-submission identity can strengthen a suggestion, but it does not
attach by itself. Outbound identities and the exact connected mailbox address
are excluded; other addresses on the same domain remain eligible. This avoids
treating every customer on a shared public domain as internal. The service
never overwrites a user-selected lead, reattaches a manually detached
conversation, or returns a cross-owner lead. Retry-safe attachment uses the
existing importer transaction and idempotent activity path.

Evidence that is credible but not uniquely identifying is review-only. This
includes a durable website-submission identity without a unique exact
participant-email candidate, multiple owned leads sharing an exact participant
email, and exact normalized participant display-name matches. These paths
never auto-attach.
Company similarity, fuzzy name similarity, email-domain inference, message
body extraction, and AI inference are not matching signals in this milestone.

Possible matches contain stable reason codes and bounded, body-free
explanations. At most three candidates are returned in deterministic order,
with a stable ID tie-breaker. The existing `Conversation.matchKind`,
`matchReason`, and `matchCandidateLeadIds` fields cache the latest evaluation;
they are not a second source of lead identity.

`ConversationLeadMatchDismissal` stores one owner-composite dismissal for a
conversation, candidate lead, and evidence fingerprint. The fingerprint
prevents the same evidence from immediately resurfacing while allowing
meaningfully changed identity evidence to be evaluated later. Deleting the
owner, conversation, or lead cascades its dismissal rows. Manual detach remains
the broader conversation-level suppression and is never undone by import.

Existing conversations use an explicit authenticated **Recheck matches**
action that loads one owned conversation and at most 100 identity-only inbound
messages before calling the same matcher. A detail render may calculate a
bounded read-only view but never persists during rendering. There is no
matching queue and no unbounded owner scan in an Inbox request. A matching
failure does not roll back provider messages that were already imported
successfully.

When this matcher creates an automatic attachment during Gmail sync, it
enqueues one owner-scoped, idempotent `COMPANY_DETECTION` job after the import
transaction. The job uses the centralized database-only detector and stored
evidence; it makes no Gmail or LLM call. Enqueue failure is isolated from the
successful import, and execution rechecks canonical attachment/company state
before any write. Fake-provider imports keep the immediate detector path for
local development.

## Timeline policy

The first successful import that creates a conversation records one idempotent,
body-free `CONVERSATION_IMPORTED` event and establishes a silent
message-history baseline. Historical messages remain in `Message` without
flooding the activity timeline. Messages first observed on later imports create
one inbound or outbound event when the conversation is attached to a lead. The
event uses the provider message timestamp and never copies the message body.

Conversation-import, message, and automatic-link events use deterministic
idempotency keys. The message/type database constraint provides an additional
duplicate guard, so retries and overlapping imports cannot duplicate timeline
events.

Calculating, displaying, ranking, or dismissing suggestions creates no
`LeadActivity`. Automatic and explicitly confirmed attachments continue to use
the existing attachment activity types and `lib/activity-service.ts`.

## Website notification extension

Normalized messages may carry `externalSubmissionId` and `sourceSystem`.
`findExistingInboundSubmissionMatch()` hashes the external ID using the same
durable idempotency scheme as website ingestion and resolves it only through an
inbound source owned by the importing user. It never creates another lead.
