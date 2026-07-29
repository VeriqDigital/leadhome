# Background jobs

LeadHome uses a deliberately small PostgreSQL-backed job queue. Gmail sync and
Conversation Intelligence use the same queue, claim, lease, retry,
cancellation, and retention machinery. It is not a workflow engine and does
not execute arbitrary user-supplied code or payloads.

Conversation Intelligence architecture, privacy boundaries, eligibility,
hashing, structured output, and provider configuration are documented in
[`conversation-intelligence.md`](./conversation-intelligence.md).

## Gmail sync lifecycle

1. An authenticated server action validates an owner-scoped, connected Gmail
   `CommunicationAccount`.
2. It enqueues a `GMAIL_SYNC` job or returns the mailbox's existing active job.
   The browser request does not call Gmail or run the message importer.
3. A worker calls `POST /api/internal/jobs/run` with the server-only runner
   secret.
4. The runner recovers stale leases, atomically claims an eligible job, and
   dispatches it by type.
5. The Gmail handler validates its typed payload, rechecks account ownership
   and connection state, creates the existing `GmailProvider`, and calls the
   existing provider-agnostic importer.
6. Progress, heartbeats, retries, and the final bounded result are persisted.
   Inbox and Settings can poll `GET /api/jobs/status?accountId=<id>` and refresh
   their server data when the returned job becomes terminal.

The Gmail handler does not duplicate Gmail normalization, conversation
upserts, message deduplication, lead matching, review behavior, or import
summary calculation.

The importer, not the queue, records business activity. A first conversation
import, later messages on attached conversations, and automatic lead links use
deterministic activity keys, so a retried job cannot duplicate those events.
Progress phases, retries, no-op checks, and operational counters are not
timeline activity.

## Execution paths

Both triggers reuse `runJobInvocation` in `lib/jobs/runner.ts`; claim,
dispatch, retry, cancellation, completion, and cleanup logic is not duplicated.

Local development follows:

1. `scripts/jobs-worker.mjs` polls with one sequential HTTP request.
2. `POST /api/internal/jobs/run` verifies `JOB_RUNNER_SECRET`.
3. The shared runner recovers stale work and performs one bounded pass.
4. `claimNextJob` atomically leases one eligible row.
5. The typed handler runs and the service persists completion, retry, terminal
   failure, cancellation, or lease loss.
6. The local process waits before beginning another pass.

Vercel production follows:

1. Vercel Cron sends `GET /api/cron/jobs` on the configured schedule.
2. The route verifies the exact `Bearer ${CRON_SECRET}` header.
3. The same shared runner performs one bounded pass and returns immediately
   when the queue is empty.

Neither route accepts a job payload or runs durable work inline in the browser
request that enqueued it.

## Job data and statuses

`Job` records carry their type and lifecycle state, a typed JSON payload,
bounded progress/result JSON, attempt and scheduling fields, lease timestamps,
safe error fields, and an idempotency key. Gmail jobs always have an `ownerId`.
OAuth tokens, authorization codes, Gmail message bodies, and raw provider
responses are never stored in job JSON.

Statuses are:

- `PENDING`: eligible at `availableAt`.
- `RUNNING`: claimed by one worker and protected by a lease.
- `RETRY_SCHEDULED`: retryable failure or stale lease waiting for
  `availableAt`.
- `COMPLETED`: terminal success, including a no-op Gmail import.
- `FAILED`: terminal failure.
- `CANCELLED`: terminal user cancellation.

The public Gmail job view omits the raw payload, lock identity, and internal
diagnostics. It exposes the safe communication-account identifier, status,
progress, result, attempt counts, timestamps, safe error code/message, and
whether the job is active.

The Gmail payload contains only:

- `communicationAccountId`
- `requestedBy: "USER"`
- a bounded `threadLimit`
- `trigger: "MANUAL"`

Its result reuses the existing importer counts and adds conversations
processed, a bounded error list, and ISO start/completion timestamps.

### Gmail result semantics

The persisted job result keeps the importer's stable field names. The Inbox
and Settings UI map those fields into three user-facing groups: activity added
by this check, review state among conversations processed by this check, and
lower-level execution details.

| Result field | Exact meaning |
| --- | --- |
| `accountsProcessed` | Communication accounts processed. A manual Gmail job currently handles one account. |
| `conversationsProcessed` | Provider conversations handled by this run: `conversationsCreated + conversationsUpdated`. |
| `conversationsCreated` | Gmail threads that created a new LeadHome conversation in this run. |
| `conversationsUpdated` | Existing LeadHome conversations revisited in this run, whether or not their visible data changed. |
| `messagesCreated` | Individual Gmail messages inserted for the first time in this run. |
| `messagesSkipped` | Messages already present, plus duplicate provider message IDs within the fetched batch. |
| `conversationsMatched` | Processed conversations for which matching found a lead. This can include a conversation already linked to that same lead; it is not a “newly linked” count. |
| `conversationsNeedingReview` | Processed, unmatched conversations whose existing review state remains `NEEDS_REVIEW`. This is run-scoped, not an Inbox-wide total. |
| `errors` | Bounded, safe item-level errors in an otherwise completed result. The current importer fails and retries a whole run on provider/import exceptions, so successful jobs normally store an empty list; the UI nevertheless handles a future partial-success result safely. |
| `startedAt` / `completedAt` | ISO timestamps bounding job execution and used to derive the displayed duration. |

A conversation means one email thread. A message means one individual email
inside a thread, so one new conversation can legitimately contain multiple
new messages. A successful no-op is a normal `COMPLETED` job and is presented
as: “Gmail is up to date. No new conversations or messages were imported.”

The richer Inbox card separates “Added this check” from run-scoped matching
and review counts, and puts operational counters behind an accessible
`View details` disclosure. Settings uses the same state language and button
labels in a more compact form. Refreshing after completion uses the current
route rather than navigating, preserving the selected conversation, search,
filters, and URL state.

## Idempotency

Only one active Gmail sync is permitted for the same owner and communication
account. `PENDING`, `RUNNING`, and `RETRY_SCHEDULED` jobs retain an active
idempotency key. Enqueue uses a database uniqueness guard, so rapid clicks and
concurrent requests either create one job or return that same canonical job.
Terminal jobs release the active key, allowing a later sync.

Enqueue and disconnect also share a transaction-scoped PostgreSQL advisory
mutex derived from the owner and mailbox IDs. Disconnect cancellation,
connection-state mutation, and credential deletion therefore commit together;
an enqueue cannot slip between those operations. The unique Job index remains
the durable second guard.

Importer-level unique constraints and upserts remain the second line of
defense. Retrying after a partial import cannot create duplicate conversations
or messages.

## Claiming and leases

Claiming uses one PostgreSQL statement with `FOR UPDATE SKIP LOCKED` and a
guarded update. It selects only eligible `PENDING` or `RETRY_SCHEDULED` rows
whose `availableAt` has passed, then atomically:

- changes status to `RUNNING`
- records a unique per-invocation worker UUID
- sets `lockedAt` and `heartbeatAt`
- sets `startedAt` on the first attempt
- increments `attemptCount`

There is no unguarded “find then update later” claim window. A second worker
cannot claim the same lease.

Like any recoverable queue, execution is at-least-once if a worker dies after
performing work but before recording completion. Lease fencing prevents the
stale worker from updating the Job after recovery, and the existing Gmail
importer's unique constraints and monotonic upserts make repeated database
effects effectively once.

Final account summaries, reconnect state, and safe sync errors are written in
a transaction that verifies and locks the current Job lease first. A cancelled
or recovered worker therefore cannot overwrite a newer attempt's account
state.

The Gmail handler checkpoints progress and heartbeats at useful chunks rather
than once per message. Progress phases are `QUEUED`, `CONNECTING`,
`LISTING_THREADS`, `IMPORTING_THREADS`, `MATCHING`, `FINALIZING`, and
`COMPLETED`.

The runner also passes its absolute execution deadline to the handler.
Individual Gmail requests use a bounded timeout and refuse to start when the
remaining window is too small. Reaching the deadline is persisted as a
retryable failure instead of allowing the platform to kill a lease silently.
The configured HTTP budget remains below the route's platform duration so the
retry transition has time to commit.

## Retries and stale recovery

Retryable failures use persisted `availableAt` scheduling. Base delays are 30
seconds, 2 minutes, and 10 minutes for attempts one through three. Later
configured attempts double the prior tier up to one hour. A ±20 percent jitter
reduces synchronized retries. The default maximum is three attempts.

Rate limits, provider 5xx responses, network timeouts, and transient database
errors are retryable. Revoked grants, `invalid_grant`, missing credentials,
deleted/disconnected accounts, ownership failures, and invalid job payloads
fail without a retry loop. Authorization failures also mark the communication
account `RECONNECT_REQUIRED` using the existing safe behavior.

A `RUNNING` job is stale when its heartbeat or lock predates
`JOB_STALE_AFTER_SECONDS` and it has no completion timestamp. Recovery uses
guarded updates so concurrent recovery workers cannot both reschedule it.
Attempts remaining become `RETRY_SCHEDULED`; exhausted jobs become `FAILED`.

Pending or retry-scheduled jobs can be cancelled immediately. Running
cancellation is cooperative: status becomes `CANCELLED`, the active
idempotency key is released, and the current handler acknowledges cancellation
between major phases. An already-running external request cannot be interrupted
instantly.

## Job-trigger security and limits

`POST /api/internal/jobs/run` is excluded from browser-session Proxy handling
because it has a separate machine credential. It requires:

```http
Authorization: Bearer <JOB_RUNNER_SECRET>
```

The route fails closed when the configured secret is absent or shorter than 40
characters, rejects surrounding whitespace, and compares SHA-256 digests with
a timing-safe comparison. A valid
LeadHome browser session does not grant worker access. The route accepts no job
type, job ID, or payload from its request body.

Every invocation gets a new worker UUID. `JOBS_PER_RUN` and
`JOB_RUN_TIME_BUDGET_MS` bound claims and execution time. The response contains
only safe operational counts and duration; it never contains payloads,
credentials, messages, or stack traces.

`GET /api/cron/jobs` is also excluded from browser-session Proxy handling, but
uses a separate production-only machine credential:

```http
Authorization: Bearer <CRON_SECRET>
```

Missing, weak, whitespace-padded, or incorrect configuration fails closed with
`401`. A browser session alone is never sufficient. The comparison is
timing-safe, the response is `no-store`, and the secret is not accepted in the
URL or body.

The cron route runs at most 10 jobs sequentially, gives the runner a
240-second internal budget, and declares a 300-second Vercel Function maximum.
The 60-second platform cushion lets deadline-aware handlers persist a retry
instead of being killed at the route limit. The runner does not sleep or wait
for future work in a Vercel invocation. It stops for an empty queue, the job
limit, the time budget, or an aborted request.

`GET /api/jobs/status` remains behind browser authentication. It requires a
valid communication-account ID and performs a second owner-scoped query before
returning the latest public Gmail job view. Responses from both routes use
`Cache-Control: no-store`.

## Local worker

Start the Next.js application, then run one bounded invocation:

```powershell
npm run jobs:once
```

For modest local polling:

```powershell
npm run jobs:worker
```

`npm run jobs:work` remains an equivalent compatibility alias.

The polling process runs requests sequentially, waits
`JOB_WORKER_POLL_INTERVAL_MS` between calls, and stops cleanly on `SIGINT` or
`SIGTERM`. It invokes the protected internal route, which calls the same shared
runner used by the Vercel route, rather than bypassing claim or dispatch logic.
The script loads the normal Next.js environment files and never prints the
runner secret. Each completed or aborted delay removes its abort listener.

## Production Vercel Cron

The repository-root `vercel.json` registers:

```json
{
  "path": "/api/cron/jobs",
  "schedule": "* * * * *"
}
```

This means once per minute, and Vercel cron expressions always use UTC.
Vercel's [current Cron usage limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
allow a one-minute minimum on Pro and Enterprise. Hobby is limited to once per
day and will reject this deployment, so LeadHome's intended production cadence
requires Vercel Pro before deployment. Cron invokes the production deployment.
Do not configure `CRON_SECRET` for Preview unless a deliberately isolated
preview database should process preview jobs; leaving it absent makes preview
HTTP calls fail closed.

Expected queue start latency is up to roughly one minute, plus Vercel
scheduling and function startup variability. Vercel does not retry a failed
cron HTTP invocation. Durable pending/retry rows remain available to the next
invocation; an interrupted running lease becomes recoverable after
`JOB_STALE_AFTER_SECONDS`.

### Deployment checklist

Deploy migrations before allowing jobs to be queued:

```powershell
npx prisma migrate deploy
npx prisma migrate status
```

Then:

1. Confirm the Vercel project is on Pro or Enterprise and Node.js is `24.x`.
2. In **Project → Settings → Environment Variables**, create `CRON_SECRET` for
   **Production** only. Generate at least 32 random bytes outside the
   repository; a 43-character base64url value is one suitable representation.
3. Keep `DATABASE_URL`, provider credentials, and the other existing server
   variables configured for Production.
4. Deploy the commit. Do not manually create a second dashboard schedule;
   `vercel.json` is the source of truth.
5. Open **Project → Settings → Cron Jobs** and verify `/api/cron/jobs` has the
   `* * * * *` schedule.
6. Use **View Logs** for that cron entry and verify structured start/finish
   records contain only counts, stop reason, and duration.

Changing the schedule requires a configuration change and production
deployment. The dashboard can disable it. Vercel Instant Rollback does not
automatically restore the prior cron definition, so verify the Cron Jobs page
after a rollback.

### Manual testing

With the Next.js server running and `CRON_SECRET` set only in the shell or
local environment file, an authorized PowerShell request is:

```powershell
$headers = @{
  Authorization = "Bearer $env:CRON_SECRET"
}

Invoke-RestMethod `
  -Method GET `
  -Uri "http://localhost:3000/api/cron/jobs" `
  -Headers $headers
```

An unauthorized check is:

```powershell
Invoke-WebRequest `
  -Method GET `
  -Uri "http://localhost:3000/api/cron/jobs" `
  -SkipHttpErrorCheck
```

For a production smoke test, use the same authorized request against the
production HTTPS URL, inspect the returned counts, enqueue one synthetic test
job through the normal application flow, invoke again, and confirm a repeated
invocation does not duplicate its business result. Never put the real secret
in source control, a committed fixture, or a URL.

## Environment variables

All settings are server-only and must never use a `NEXT_PUBLIC_` prefix.

| Variable | Purpose |
| --- | --- |
| `JOB_RUNNER_SECRET` | High-entropy worker bearer secret; at least 40 characters with no surrounding whitespace |
| `CRON_SECRET` | Production Vercel Cron bearer secret; at least 32 random bytes (43+ base64url characters), never `NEXT_PUBLIC_`; Preview is disabled by default by leaving it unset |
| `JOB_MAX_ATTEMPTS` | Bounded default attempt count |
| `JOB_STALE_AFTER_SECONDS` | Age at which an uncompleted lease is recoverable |
| `JOBS_PER_RUN` | Maximum jobs claimed by one HTTP invocation |
| `JOB_RUN_TIME_BUDGET_MS` | Time budget before the runner stops claiming work |
| `JOB_RUNNER_URL` | Full endpoint used by the local worker; HTTPS is required except for loopback development, and credentials/query strings are rejected |
| `JOB_WORKER_POLL_INTERVAL_MS` | Local polling delay, minimum one second |
| `GMAIL_SYNC_THREAD_LIMIT` | Maximum Gmail threads in one job, capped at 100 |
| `OPENAI_API_KEY` | Server-only OpenAI credential required for Conversation Intelligence |
| `OPENAI_CONVERSATION_ANALYSIS_MODEL` | Explicit server-side model used for conversation analysis |
| `AI_ANALYSIS_MAX_INPUT_CHARS` | Bounded normalized conversation input; defaults to 60,000 |
| `AI_ANALYSIS_REQUEST_TIMEOUT_MS` | Provider timeout, also bounded by the worker deadline; defaults to 45 seconds |
| `AI_ANALYSIS_VERSION` | Content/prompt version included in idempotent analysis hashing |
| `RUN_OPENAI_SMOKE_TEST` | Explicit opt-in for a synthetic live-provider smoke test; normal tests never call OpenAI |

Rotate both bearer secrets through the deployment secret store.
`JOB_RUNNER_SECRET` rotation may briefly require updating local/external
workers at the same time. Vercel automatically sends the configured
`CRON_SECRET` as the cron request's Bearer header.

## Retention and observability

The bounded cleanup service deletes at most 100 rows per call by default:

- `COMPLETED` and `CANCELLED` jobs are eligible after 30 days.
- `FAILED` jobs are eligible after 90 days.
- Active jobs are never retention candidates.

Each authenticated worker invocation runs this bounded cleanup before claiming
new work. No separate cleanup schedule or browser-request cleanup is installed.
The hard row limit prevents retention work from taking over an invocation while
ensuring the table does not grow forever once the worker is being invoked.

Safe structured events cover queue, claim, start, retry, completion, failure,
and stale recovery. They include job/type identifiers, attempt, duration, and
bounded counts. They omit OAuth data, message content, provider payloads, and
stack traces that could contain customer information.

Each cron invocation adds a structured start record and a finish record with
claimed, completed, failed, retried, cancelled, lease-lost, stale-recovered,
purged, stop-reason, and duration fields. A route-level failure logs only its
event and duration. Cron responses and invocation logs never include complete
payloads, email bodies, prompts, OAuth/access tokens, personal data, arbitrary
error text, or stack traces.

Conversation-analysis Jobs retain only bounded operational result metadata.
Canonical `ConversationAnalysis` records retain the model, input/output/total
token counts, duration, content hash, and truncation state. Pricing is not
hardcoded and no monetary cost estimate is stored.

A successful Conversation Intelligence handler writes its canonical result and
one idempotent `AI_ANALYSIS_COMPLETED` activity in the same lease-fenced
transaction. Failed, skipped, or cancelled attempts do not create that event.

## Intentionally deferred

The job system does not implement automatic scheduled Gmail sync, email
sending, Gmail modification, WebSockets, Kafka, microservices,
user-configurable workflows, a visual automation builder, autonomous actions,
teams, or billing.

Vercel Cron is a queue drainer, not a replacement for the durable queue. The
system remains at-least-once: an invocation can perform an external effect and
end before committing completion. Handlers must remain idempotent, claims must
continue using database leases, and no in-memory process lock may be used.
Overlapping or duplicate cron delivery is safe because `FOR UPDATE SKIP
LOCKED` lets only one invocation lease a row. If a function ends while work is
leased, heartbeats stop; stale recovery later schedules another attempt or
marks an exhausted job failed. There is not yet an alert for a stalled queue,
and a single job that cannot finish inside its deadline must retry or be split
into smaller durable work.
