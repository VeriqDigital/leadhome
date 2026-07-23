"use client";

import { useActionState, useState } from "react";
import { Check, Clipboard, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  createInboundSourceAction,
  deleteInboundSourceAction,
  rotateInboundSourceAction,
  setInboundSourceActiveAction,
  type SourceActionState,
} from "@/app/actions/inbound-source-actions";

type Source = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
};

const initialState: SourceActionState = {};

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]">
      {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function RevealedToken({ state }: { state: SourceActionState }) {
  if (!state.token) return state.message ? (
    <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${state.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{state.message}</p>
  ) : null;
  return (
    <div className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-amber-950" role="status">
      <p className="text-sm font-semibold">{state.message}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white/80 px-3 py-2 text-xs">{state.token}</code>
        <CopyButton value={state.token} label="Copy token" />
      </div>
    </div>
  );
}

function CreateSourceForm() {
  const [state, action, pending] = useActionState(createInboundSourceAction, initialState);
  return (
    <div>
      <form action={action} className="flex flex-col gap-3 sm:flex-row">
        <input name="name" required minLength={2} maxLength={100} placeholder="Marketing website" className="h-11 min-w-0 flex-1 rounded-xl border border-black/[0.09] bg-transparent px-3.5 text-sm outline-none focus:border-[#7770c8]" />
        <button disabled={pending} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#17181c] px-5 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create source
        </button>
      </form>
      <RevealedToken state={state} />
    </div>
  );
}

function RotateTokenForm({ sourceId }: { sourceId: string }) {
  const [state, action, pending] = useActionState(rotateInboundSourceAction, initialState);
  return (
    <div className="mt-3">
      <form action={action}>
        <input type="hidden" name="sourceId" value={sourceId} />
        <button disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 py-2 text-xs font-semibold hover:bg-black/[0.03] disabled:opacity-60">
          <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} /> Rotate token
        </button>
      </form>
      <RevealedToken state={state} />
    </div>
  );
}

export function WebsiteSources({ sources, endpoint }: { sources: Source[]; endpoint: string }) {
  const routeSnippet = `// app/api/contact/route.ts (on your website server)\nexport async function POST(request: Request) {\n  const form = await request.json();\n  const response = await fetch(\n    \`\${process.env.LEADHOME_URL}/api/inbound/forms\`,\n    {\n      method: "POST",\n      headers: {\n        "Content-Type": "application/json",\n        Authorization: \`Bearer \${process.env.LEADHOME_SOURCE_TOKEN}\`,\n        "Idempotency-Key": crypto.randomUUID(),\n      },\n      body: JSON.stringify(form),\n    },\n  );\n  return Response.json(await response.json(), { status: response.status });\n}`;
  const curlSnippet = `curl -X POST "${endpoint}" \\\n  -H "Authorization: Bearer YOUR_SOURCE_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: contact-12345" \\\n  -d '{"name":"Jane Doe","email":"jane@example.com","message":"Please call me"}'`;

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-4 flex items-center gap-2"><KeyRound className="size-5 text-[#687080]" /><h3 className="font-semibold">Website Sources</h3></div>
        <p className="mb-5 max-w-3xl text-sm text-[#687080]">Create one token per website. Tokens are shown once and must stay on your website server—never embed them in browser JavaScript.</p>
        <CreateSourceForm />
      </section>

      <section className="space-y-3">
        {sources.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/[0.1] p-5 text-sm text-[#687080]">No website sources yet.</p>
        ) : sources.map((source) => (
          <article key={source.id} className="rounded-xl border border-black/[0.08] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h4 className="text-sm font-semibold">{source.name}</h4><p className="mt-1 text-xs text-[#687080]">Created {new Date(source.createdAt).toLocaleDateString()}</p></div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${source.isActive ? "bg-green-50 text-green-700" : "bg-neutral-100 text-neutral-600"}`}>{source.isActive ? "Active" : "Disabled"}</span>
            </div>
            <RotateTokenForm sourceId={source.id} />
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={setInboundSourceActiveAction}>
                <input type="hidden" name="sourceId" value={source.id} /><input type="hidden" name="isActive" value={String(!source.isActive)} />
                <button className="rounded-lg border border-black/[0.08] px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]">{source.isActive ? "Disable" : "Re-enable"}</button>
              </form>
              <form action={deleteInboundSourceAction}>
                <input type="hidden" name="sourceId" value={source.id} />
                <button className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"><Trash2 className="size-3.5" /> Delete</button>
              </form>
            </div>
          </article>
        ))}
      </section>

      <section className="space-y-4 border-t border-black/[0.07] pt-7">
        <div><h3 className="text-sm font-semibold">Endpoint</h3><div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-[#f3f4f6] px-3 py-2 text-xs">{endpoint}</code><CopyButton value={endpoint} /></div></div>
        <div><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Next.js route handler</h3><CopyButton value={routeSnippet} /></div><pre className="mt-2 overflow-x-auto rounded-xl bg-[#17181c] p-4 text-xs leading-5 text-neutral-200"><code>{routeSnippet}</code></pre></div>
        <div><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">curl</h3><CopyButton value={curlSnippet} /></div><pre className="mt-2 overflow-x-auto rounded-xl bg-[#17181c] p-4 text-xs leading-5 text-neutral-200"><code>{curlSnippet}</code></pre></div>
      </section>
    </div>
  );
}
