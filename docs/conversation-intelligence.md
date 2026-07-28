# Conversation Intelligence

Conversation Intelligence is an explicitly enabled, owner-scoped feature that
creates a factual structured analysis of selected conversations. It runs only
through the existing PostgreSQL-backed worker. An interactive browser request
can enqueue work, but it never sends conversation text to OpenAI or waits for
inference.

This is a conversation-analysis feature, not a general-purpose "Enable AI"
switch. It does not implement a chatbot or autonomous workflow.

## Opt-in and eligibility

The preference is disabled by default for every owner. Enabling it in Settings
does not backfill or scan the existing Inbox.

Automatic analysis is limited to conversations that:

- belong to the owner;
- are attached to a Lead;
- have meaningful message text;
- changed during a Gmail import or just became attached to a Lead; and
- belong to an owner who has explicitly enabled Conversation Intelligence.

An unlinked conversation can be analyzed only when the owner has enabled the
feature and explicitly requests analysis for that conversation.

Disabling the preference prevents new enqueues and cancels that owner's
pending or retry-scheduled analysis jobs. Running work uses cooperative
cancellation at its next lease checkpoint. Previously completed canonical
analyses remain available.

## Job lifecycle

The feature adds `CONVERSATION_ANALYSIS` to the existing generic `Job` queue:

1. An owner-scoped service checks the preference and conversation eligibility.
2. It prepares and hashes a bounded input without calling OpenAI.
3. It creates one typed job or returns the existing active job for that
   owner/conversation.
4. The existing worker atomically claims the job and verifies its lease.
5. The handler rechecks the owner, preference, current attachment eligibility,
   content, and analysis version.
6. The provider receives strict system instructions and bounded conversation
   data through the Responses API with Structured Outputs.
7. Zod validates the parsed response and every evidence ordinal.
8. A lease-fenced transaction replaces the one canonical current analysis and
   records one idempotent `AI_ANALYSIS_COMPLETED` activity.
9. The Job stores only a bounded operational result.

The payload contains only:

- `conversationId`
- `trigger`
- `force`
- `analysisVersion`

It never contains message bodies, subjects, participants, credentials, API
keys, prompts, or provider responses.

The bounded result contains the canonical analysis ID, content hash, analysis
version, outcome, model, token counts, duration, and truncation flag. The
structured business details live only in `ConversationAnalysis`, not in Job
JSON.

## Idempotency and versioning

The active Job idempotency key is the conversation ID, scoped by owner and job
type. `PENDING`, `RUNNING`, and `RETRY_SCHEDULED` work is reused, so repeated
clicks do not create parallel analyses.

The complete normalized canonical content is hashed with SHA-256 together with
the analysis input version, before the provider-facing text is truncated. This
means an out-of-order message still changes the hash even if it falls in an
omitted middle section. Automatic analysis is skipped when a completed canonical analysis
already has the same hash and version. Meaningful content changes create a new
hash. Changing `AI_ANALYSIS_VERSION` permits a new analysis without changing
message history. Explicit manual reanalysis can force another job while still
reusing any active job.

`latestJobId` on the canonical analysis fences writes from older jobs. Job
lease verification additionally prevents a cancelled or recovered worker from
overwriting a newer result.

## Data sent to OpenAI

Only the minimum analysis input is sent:

- subject;
- participant display names and email addresses;
- message direction;
- message timestamp; and
- normalized plain-text message body.

LeadHome does not send owner IDs, database IDs, Gmail provider IDs, internal
Job IDs, OAuth data, access or refresh tokens, account configuration, raw MIME
payloads, tracking markup, or attachment contents.

HTML is converted to bounded plain text. Script, style, head, SVG, comments,
tags, and obvious tracking-only markup are removed. Whitespace is normalized,
and lines quoted with `>` are omitted when earlier stored messages already
represent that text. Messages remain chronological and receive safe evidence
labels such as `M1`, `M2`, and `M3`.

Email content is untrusted data. The system prompt instructs the model not to
follow instructions found inside messages and not to let an email alter the
schema or analysis rules.

Provider response storage is disabled with `store: false`. Application logs do
not contain subjects, participants, message bodies, summaries, extracted
details, action-item text, prompts, or raw model output.

## Input bounds and truncation

`AI_ANALYSIS_MAX_INPUT_CHARS` bounds the normalized request. The accepted range
is 4,000 through 200,000 characters and the default is 60,000.

When the complete input exceeds the bound, preparation deterministically keeps:

- the subject and bounded participant header;
- the earliest meaningful message; and
- the newest meaningful message.

Message bodies are divided across the remaining character budget. The stored
analysis and Job result record `inputTruncated = true`. If no meaningful body
text remains, the handler records a skipped no-content outcome without calling
OpenAI.

## Structured output

The strict V1 schema permits only:

- a concise summary;
- suggested company, contact, and project type;
- an explicitly discussed budget and currency;
- an explicitly supported timeline;
- sentiment;
- a bounded list of suggested action items; and
- a bounded list of missing information.

Unknown details stay `null`. Confidence is bounded from 0 through 1. Evidence
arrays are bounded and may reference only message ordinals included in the
request. Strings, action items, missing-information items, and arrays all have
fixed limits.

The model is instructed not to invent company, contact, phone, budget, date,
currency, or project information. It does not estimate deal value or close
probability.

Suggested details remain separate from manually maintained Lead fields.
Suggested action items do not create Tasks automatically. A user must open the
editable task form, review or change its prefilled values, and explicitly save
one task at a time.

## Completed analysis presentation

The Inbox presents a completed analysis as a concise, expandable summary,
responsive key-details grid, compact contact links, sentiment indicator,
suggested actions, and a bounded list of information to clarify. Presentation
helpers normalize whitespace and format structured dates without changing the
canonical stored analysis.

Copy summary copies the complete persisted summary. Copy notes builds a
deterministic plain-text overview from the existing structured result and
omits provider and operational metadata. These controls, timeline formatting,
and disclosures make no additional OpenAI requests.

Suggested actions continue to pass only the analysis ID and bounded action
index into the owner-scoped task-prefill flow. Opening that form does not
create a Task; the user must review the fields and explicitly save it. On save,
the task service rereads the owned analysis and suggestion and records the
validated AI provenance in the task-created activity. No completed-analysis
presentation action mutates a Lead.

Successful completion activity uses the analysis completion time, actor `AI`,
source `AI`, and a job/analysis-derived idempotency key. It contains only safe
operational metadata such as the analysis ID, action-item count, and input
truncation flag. It does not copy the summary, extracted contacts, suggested
actions, evidence, or message text into activity metadata.

## Canonical persistence and retention

There is one owner-scoped `ConversationAnalysis` for each conversation. Its
composite conversation/owner foreign key enforces ownership and deletes the
analysis when its conversation is deleted.

The canonical record stores structured output, the successful content hash and
version, safe error state, source-message count, truncation state, model, token
usage, duration, and lifecycle timestamps. A failed reanalysis does not erase
the previous successful summary or structured details. A later successful
analysis may replace them.

Generic Job retention remains:

- completed and cancelled Jobs: 30 days;
- failed Jobs: 90 days;
- active Jobs: never purged.

Canonical analyses are independent of Job retention and remain until their
conversation is deleted.

## Configuration

All variables are server-only. Never expose them with a `NEXT_PUBLIC_` prefix.

| Variable | Required | Default and bounds |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes for analysis | No default |
| `OPENAI_CONVERSATION_ANALYSIS_MODEL` | Yes for analysis | No default; the application does not permanently hardcode a model |
| `AI_ANALYSIS_MAX_INPUT_CHARS` | No | `60000`; 4,000-200,000 |
| `AI_ANALYSIS_REQUEST_TIMEOUT_MS` | No | `45000`; 5,000-120,000 and further limited by the worker deadline |
| `AI_ANALYSIS_VERSION` | No | `conversation-v1`; maximum 64 characters |
| `RUN_OPENAI_SMOKE_TEST` | No | `false`; real-provider tests are explicitly opt-in |

The Settings page may report whether configuration is available, but it never
returns the key or lets a browser modify the server-side model. Missing key or
model configuration is a safe non-retryable job failure.

The OpenAI SDK's internal retries are disabled. The Job queue owns bounded
retry scheduling.

## Failure and retry behavior

Rate limits, connection timeouts, temporary provider failures, provider 5xx
responses, and transient database errors are retryable through the existing
Job policy.

Malformed payloads, deleted or wrong-owner conversations, disabled preference,
missing configuration, unsupported requests, and provider refusals fail or
cancel safely without an uncontrolled retry loop. Invalid structured output
receives at most one immediate retry using the same strict schema; a second
validation failure becomes a safe non-retryable error.

Only bounded error codes and user-safe messages are persisted. Raw provider
responses, prompts, email bodies, API keys, and stack traces are not stored in
user-visible metadata.

The Inbox exposes explicit Analyze, queued, running, Reanalyze, and retry
states. Reanalysis always queues background work and returns promptly.
Queued, skipped, failed, and cancelled attempts do not create timeline events;
only a successfully persisted canonical analysis does.

## Local development and production

Local development needs both the application and a worker:

```powershell
npm run dev
npm run jobs:work
```

Use `npm run jobs:once` to drain one bounded worker invocation.

Normal automated tests use a mockable provider and never call OpenAI. A live
smoke test is permitted only when `RUN_OPENAI_SMOKE_TEST="true"` and valid
OpenAI configuration is present. It must use synthetic business-email text,
must not use Gmail content, and must not print the full prompt or response.

Run only the built-in synthetic smoke fixture when explicitly needed:

```powershell
$env:RUN_OPENAI_SMOKE_TEST="true"
npx vitest run lib/ai/conversation-analysis/openai-smoke.test.ts
```

Unset the flag afterward. The normal `npm test` path leaves this test skipped.

Production must deploy the Conversation Intelligence migration before jobs are
queued. It must also invoke the existing secret-protected
`POST /api/internal/jobs/run` endpoint through a persistent worker or
production scheduler. There is no browser-side or automatic inference fallback
when the worker is not running.

## Intentionally deferred

Conversation Intelligence V1 does not implement:

- inbox-wide automatic AI analysis;
- chatbot or reply generation;
- email sending or Gmail modification;
- automatic lead creation or attachment;
- automatic task creation;
- automatic CRM-field mutation;
- deal-close probability or inferred deal value;
- embeddings, vector search, or RAG;
- attachment analysis, OCR, transcription, or voice;
- user-defined prompts or AI workflows;
- agents or tool calling;
- usage billing, teams, or a usage analytics dashboard.
