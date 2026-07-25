# Messaging import architecture

LeadHome treats provider adapters as normalization boundaries. Adapters return
`NormalizedProviderAccount`, `NormalizedConversation`, and
`NormalizedMessage`; the importer does not consume Gmail-, Outlook-, or
fixture-specific payloads.

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

The importer uses Policy A. A conversation's first successful import establishes
a silent historical baseline. Historical messages remain in `Message` but do
not flood `LeadActivity`. Messages first observed on later imports can create
one body-free activity reference when the conversation is already attached.
The database prevents duplicate message activities.

## Website notification extension

Normalized messages may carry `externalSubmissionId` and `sourceSystem`.
`findExistingInboundSubmissionMatch()` hashes the external ID using the same
durable idempotency scheme as website ingestion and resolves it only through an
inbound source owned by the importing user. It never creates another lead.
