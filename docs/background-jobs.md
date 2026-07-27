# Background jobs

LeadHome uses a deliberately small PostgreSQL-backed job queue. Gmail sync is
its first workload. The queue is generic enough for another bounded job type,
but it is not a workflow engine and does not execute arbitrary user-supplied
code or payloads.

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

## Worker endpoint security and limits

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
npm run jobs:work
```

The polling process runs requests sequentially, waits
`JOB_WORKER_POLL_INTERVAL_MS` between calls, and stops cleanly on `SIGINT` or
`SIGTERM`. It invokes the same protected HTTP endpoint as production rather
than bypassing claim or dispatch logic. The script loads the normal Next.js
environment files and never prints the runner secret.

## Production invocation

Deploy migrations before allowing jobs to be queued:

```powershell
npx prisma migrate deploy
npx prisma migrate status
```

An operator or external trigger can drain work with:

```powershell
curl.exe -X POST `
  -H "Authorization: Bearer $env:JOB_RUNNER_SECRET" `
  -H "Accept: application/json" `
  "https://your-leadhome.example/api/internal/jobs/run"
```

No automatic schedule is installed in this phase. A future platform cron may
invoke only this endpoint; it must not create arbitrary jobs or expose its
secret to browser JavaScript.

Configuring an external trigger or continuously running `jobs:work` process is
a production deployment prerequisite. Without a drainer, manual sync requests
will correctly remain queued; the browser request itself never executes Gmail
work.

## Environment variables

All settings are server-only and must never use a `NEXT_PUBLIC_` prefix.

| Variable | Purpose |
| --- | --- |
| `JOB_RUNNER_SECRET` | High-entropy worker bearer secret; at least 40 characters with no surrounding whitespace |
| `JOB_MAX_ATTEMPTS` | Bounded default attempt count |
| `JOB_STALE_AFTER_SECONDS` | Age at which an uncompleted lease is recoverable |
| `JOBS_PER_RUN` | Maximum jobs claimed by one HTTP invocation |
| `JOB_RUN_TIME_BUDGET_MS` | Time budget before the runner stops claiming work |
| `JOB_RUNNER_URL` | Full endpoint used by the local worker; HTTPS is required except for loopback development, and credentials/query strings are rejected |
| `JOB_WORKER_POLL_INTERVAL_MS` | Local polling delay, minimum one second |
| `GMAIL_SYNC_THREAD_LIMIT` | Maximum Gmail threads in one job, capped at 100 |

Rotate `JOB_RUNNER_SECRET` through the deployment secret store. A rotation may
briefly require updating external triggers and workers at the same time.

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

The generic JSON result can later carry bounded provider-neutral usage
metadata, such as a model name, token counts, and estimated cost. No
OpenAI-specific columns or AI calls are part of this phase.

## Intentionally deferred

This phase does not implement AI processing, automatic scheduled Gmail sync,
email sending, Gmail modification, WebSockets, Kafka, microservices,
user-configurable workflows, a visual automation builder, teams, or billing.
