"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  Check,
  ChevronDown,
  Clipboard,
  ExternalLink,
  FlaskConical,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  createInboundSourceAction,
  deleteInboundSourceAction,
  rotateInboundSourceAction,
  setInboundSourceActiveAction,
  testInboundSourceAction,
  type SourceActionState,
} from "@/app/actions/inbound-source-actions";

type Source = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
};

const initialState: SourceActionState = {};
const buttonFocus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7770c8]";
const secondaryButton = `inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-black/[0.09] px-3.5 text-xs font-semibold transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50 dark:!bg-transparent dark:!text-neutral-200 dark:border-white/10 dark:hover:!bg-white/[0.06] ${buttonFocus}`;

function CopyButton({
  value,
  label = "Copy",
  prominent = false,
}: {
  value: string;
  label?: string;
  prominent?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        prominent
          ? `inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 text-xs font-bold text-[#17181c] hover:bg-neutral-200 dark:!bg-white dark:!text-[#17181c] dark:hover:!bg-neutral-200 ${buttonFocus}`
          : secondaryButton
      }
    >
      {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function OneTimeTokenPanel({ state }: { state: SourceActionState }) {
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);

  if (!state.token || dismissedToken === state.token) {
    return state.message && !state.success ? (
      <p
        role="status"
        aria-live="polite"
        className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
      >
        {state.message}
      </p>
    ) : null;
  }

  return (
    <div
      className="relative mt-4 rounded-xl border border-emerald-400/25 bg-[#111914] p-4 text-neutral-100"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => setDismissedToken(state.token ?? null)}
        aria-label="Dismiss token"
        className={`absolute right-3 top-3 grid size-8 place-items-center rounded-md text-neutral-400 hover:bg-white/10 hover:text-white ${buttonFocus}`}
      >
        <X className="size-4" />
      </button>
      <div className="pr-10">
        <p className="text-sm font-semibold text-white">Copy this token now</p>
        <p className="mt-1 text-xs leading-5 text-neutral-400">
          For security, LeadHome will not show this token again.
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-white/10 bg-[#090b0d] px-3 py-3 font-mono text-xs text-neutral-200">
          {state.token}
        </code>
        <CopyButton value={state.token} label="Copy token" prominent />
      </div>
    </div>
  );
}

function CreateSourceForm() {
  const [state, action, pending] = useActionState(
    createInboundSourceAction,
    initialState,
  );

  return (
    <div className="mt-6">
      <form action={action} className="flex flex-col gap-3 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Source name</span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            placeholder="Source name, e.g. Budget Garage Website"
            className={`h-11 w-full rounded-xl border border-black/[0.09] bg-[#f4f4f2] px-3.5 text-sm text-[#17181c] outline-none placeholder:text-[#858b96] focus:border-[#7770c8] dark:border-white/10 dark:bg-[#111216] dark:text-neutral-100 dark:placeholder:text-neutral-600 ${buttonFocus}`}
          />
        </label>
        <button
          disabled={pending}
          className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#17181c] px-5 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60 dark:!bg-neutral-100 dark:!text-[#17181c] dark:hover:!bg-white ${buttonFocus}`}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Create source
        </button>
      </form>
      <OneTimeTokenPanel state={state} />
    </div>
  );
}

function WebsiteSourceCard({ source }: { source: Source }) {
  const [rotateState, rotateAction, rotatePending] = useActionState(
    rotateInboundSourceAction,
    initialState,
  );

  return (
    <article className="rounded-xl border border-black/[0.08] bg-white p-5 shadow-[0_8px_24px_rgba(23,24,28,0.025)] dark:border-white/[0.08] dark:bg-[#1d1e23] dark:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h4 className="text-sm font-semibold">{source.name}</h4>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                source.isActive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
                  : "bg-neutral-100 text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-400"
              }`}
            >
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${
                  source.isActive ? "bg-emerald-500" : "bg-neutral-400"
                }`}
              />
              {source.isActive ? "Active" : "Disabled"}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-[#777e8a] dark:text-neutral-500">
            Created {new Date(source.createdAt).toLocaleDateString()} · Source
            ID ending {source.id.slice(-6)}
          </p>
        </div>
      </div>

      <p className="mt-5 text-sm text-[#687080] dark:text-neutral-400">
        Submissions using this source will appear as Website leads.
      </p>

      <OneTimeTokenPanel state={rotateState} />

      <div className="mt-5 border-t border-black/[0.06] pt-4 dark:border-white/[0.07]">
        <div className="flex flex-wrap gap-2">
          <form
            action={rotateAction}
            onSubmit={(event) => {
              if (
                !window.confirm(
                  "Rotate this token? The current token will stop working immediately.",
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="sourceId" value={source.id} />
            <button disabled={rotatePending} className={secondaryButton}>
              <RefreshCw
                className={`size-3.5 ${rotatePending ? "animate-spin" : ""}`}
              />
              Rotate token
            </button>
          </form>
          <form action={setInboundSourceActiveAction}>
            <input type="hidden" name="sourceId" value={source.id} />
            <input
              type="hidden"
              name="isActive"
              value={String(!source.isActive)}
            />
            <button className={secondaryButton}>
              {source.isActive ? "Disable" : "Enable"}
            </button>
          </form>
          <form
            action={deleteInboundSourceAction}
            onSubmit={(event) => {
              if (
                !window.confirm(
                  `Delete “${source.name}”? Its token will stop working immediately.`,
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="sourceId" value={source.id} />
            <button
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 px-3.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:!bg-transparent dark:!text-red-300 dark:border-red-500/20 dark:hover:!bg-red-500/10 ${buttonFocus}`}
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}

function IntegrationSteps() {
  const steps = [
    "Copy the source token",
    "Add the token and LeadHome URL to your website’s server environment variables",
    "Forward website form submissions to LeadHome",
    "Send a test lead and confirm it appears on the dashboard",
  ];

  return (
    <section aria-labelledby="connect-source-title">
      <h3 id="connect-source-title" className="text-sm font-semibold">
        Connect this source
      </h3>
      <ol className="mt-4 grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step}
            className="flex gap-3 rounded-xl border border-black/[0.07] bg-white p-3.5 dark:border-white/[0.07] dark:bg-[#1a1b20]"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#24252a] text-[11px] font-bold text-white dark:bg-neutral-100 dark:text-[#17181c]">
              {index + 1}
            </span>
            <span className="text-xs leading-5 text-[#687080] dark:text-neutral-400">
              {step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EndpointField({ endpoint }: { endpoint: string }) {
  return (
    <section>
      <label className="text-sm font-semibold" htmlFor="leadhome-endpoint">
        LeadHome endpoint
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="leadhome-endpoint"
          readOnly
          value={endpoint}
          className="h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-[#101115] px-3.5 font-mono text-xs text-neutral-200 outline-none selection:bg-[#7770c8] selection:text-white"
        />
        <CopyButton value={endpoint} label="Copy endpoint" />
      </div>
    </section>
  );
}

function TestConnectionCard({ sources }: { sources: Source[] }) {
  const [state, action, pending] = useActionState(
    testInboundSourceAction,
    initialState,
  );
  const activeSources = sources.filter((source) => source.isActive);

  return (
    <section className="rounded-xl border border-black/[0.08] bg-white p-5 dark:border-white/[0.08] dark:bg-[#1a1b20]">
      <div className="flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#f1f2f4] text-[#626976] dark:bg-white/[0.06] dark:text-neutral-300">
          <FlaskConical className="size-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold">Test connection</h3>
          <p className="mt-1 text-xs leading-5 text-[#687080] dark:text-neutral-400">
            Send a safe sample lead and confirm it reaches your dashboard.
          </p>
        </div>
      </div>
      <form action={action} className="mt-5 flex flex-col gap-3 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Active website source</span>
          <select
            name="sourceId"
            required
            disabled={activeSources.length === 0 || pending}
            defaultValue={activeSources[0]?.id ?? ""}
            className={`h-11 w-full rounded-xl border border-black/[0.09] bg-transparent px-3.5 text-sm outline-none dark:border-white/10 dark:bg-[#111216] dark:text-neutral-200 ${buttonFocus}`}
          >
            {activeSources.length === 0 ? (
              <option value="">No active sources</option>
            ) : (
              activeSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          disabled={activeSources.length === 0 || pending}
          className={secondaryButton}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <FlaskConical className="size-4" />
          )}
          {pending ? "Sending test…" : "Send test lead"}
        </button>
      </form>
      <div className="mt-3 min-h-5 text-sm" aria-live="polite">
        {state.message && (
          <p
            className={
              state.success
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-red-700 dark:text-red-300"
            }
          >
            {state.message}{" "}
            {state.leadId && (
              <Link
                href={`/leads/${state.leadId}`}
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
              >
                View lead <ExternalLink className="size-3.5" />
              </Link>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

function CodeExample({ code }: { code: string }) {
  return (
    <div className="relative">
      <div className="absolute right-3 top-3 z-10">
        <CopyButton value={code} />
      </div>
      <pre className="max-h-105 overflow-auto rounded-xl border border-white/10 bg-[#101115] p-4 pr-24 font-mono text-xs leading-5 text-neutral-300">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function DeveloperIntegration({ endpoint }: { endpoint: string }) {
  const [tab, setTab] = useState<"next" | "curl">("next");
  const routeSnippet = `# .env.local (server only)
LEADHOME_URL=${new URL(endpoint).origin}
LEADHOME_SOURCE_TOKEN=your_source_token

// app/api/contact/route.ts
export async function POST(request: Request) {
  const form = await request.json();
  const response = await fetch(
    \`\${process.env.LEADHOME_URL}/api/inbound/forms\`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: \`Bearer \${process.env.LEADHOME_SOURCE_TOKEN}\`,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(form),
    },
  );
  return Response.json(await response.json(), { status: response.status });
}`;
  const curlSnippet = `curl -X POST "${endpoint}" \\
  -H "Authorization: Bearer YOUR_SOURCE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: contact-12345" \\
  -d '{"name":"Jane Doe","email":"jane@example.com","message":"Please call me"}'`;

  return (
    <details className="group rounded-xl border border-black/[0.08] bg-white dark:border-white/[0.08] dark:bg-[#1a1b20]">
      <summary
        className={`flex cursor-pointer list-none items-center gap-3 p-5 marker:hidden ${buttonFocus}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            Developer integration
          </span>
          <span className="mt-1 block text-xs text-[#687080] dark:text-neutral-400">
            Use these examples when connecting a custom website.
          </span>
        </span>
        <ChevronDown className="size-4 text-[#687080] transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-black/[0.07] p-5 dark:border-white/[0.07]">
        <div
          className="mb-4 inline-flex rounded-lg border border-black/[0.08] bg-[#f3f4f6] p-1 dark:border-white/[0.08] dark:bg-[#111216]"
          role="tablist"
          aria-label="Integration example"
        >
          {[
            ["next", "Next.js"],
            ["curl", "curl"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value as "next" | "curl")}
              className={`rounded-md px-3 py-2 text-xs font-semibold ${
                tab === value
                  ? "bg-white text-[#17181c] shadow-sm dark:bg-[#292b31] dark:text-white"
                  : "text-[#687080] dark:text-neutral-500"
              } ${buttonFocus}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          <CodeExample code={tab === "next" ? routeSnippet : curlSnippet} />
        </div>
      </div>
    </details>
  );
}

export function WebsiteSources({
  sources,
  endpoint,
}: {
  sources: Source[];
  endpoint: string;
}) {
  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-[#f1f2f4] text-[#5f6672] dark:bg-white/[0.06] dark:text-neutral-300">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Website Sources</h2>
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[#687080] dark:text-neutral-400">
              Connect website contact forms to LeadHome. Each source gets its
              own secure token so incoming submissions are assigned to the
              correct account.
            </p>
            <p className="mt-2 text-xs text-[#858b96] dark:text-neutral-500">
              Tokens must only be stored on the website server. Never expose
              them in browser JavaScript.
            </p>
          </div>
        </div>
        <CreateSourceForm />
      </section>

      <section aria-label="Existing website sources" className="space-y-3">
        {sources.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/[0.1] p-5 text-sm text-[#687080] dark:border-white/10 dark:text-neutral-400">
            No website sources yet. Create one above to get started.
          </p>
        ) : (
          sources.map((source) => (
            <WebsiteSourceCard key={source.id} source={source} />
          ))
        )}
      </section>

      <IntegrationSteps />
      <EndpointField endpoint={endpoint} />
      <TestConnectionCard sources={sources} />
      <DeveloperIntegration endpoint={endpoint} />
    </div>
  );
}
