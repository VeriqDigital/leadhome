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

Matching is deterministic and owner-scoped. Existing attachments win. A durable
website submission ID is checked next. Otherwise only exact normalized inbound
sender or reply-to email addresses qualify. Internal account-domain addresses
are excluded. Exactly one lead is high-confidence; multiple leads are
ambiguous; subject, body, names, and fuzzy similarity are never used.

Only a high-confidence match can auto-attach, and ignored, resolved, or manually
detached conversations are never silently changed.

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

## Website notification extension

Normalized messages may carry `externalSubmissionId` and `sourceSystem`.
`findExistingInboundSubmissionMatch()` hashes the external ID using the same
durable idempotency scheme as website ingestion and resolves it only through an
inbound source owned by the importing user. It never creates another lead.
