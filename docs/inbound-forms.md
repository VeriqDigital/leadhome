# Website form ingestion

LeadHome accepts server-to-server contact form submissions at `POST /api/inbound/forms`. Create a source under **Settings → Website Sources**, then copy its token immediately. LeadHome stores only its SHA-256 hash, so a lost token must be rotated.

## Setup

1. Set `DATABASE_URL` and `AUTH_SECRET` as described in `.env.example`.
2. Optionally set `INBOUND_RATE_LIMIT_PER_MINUTE` (default: `20` per source token and IP in a 60-second window).
3. Apply migrations with `npm run db:migrate:deploy`, then run
   `npm run db:generate`.
4. Put `LEADHOME_URL` and `LEADHOME_SOURCE_TOKEN` in the external website's **server-only** environment. These variables belong to the integrating website, not LeadHome.

Browser CORS access is disabled by default: a request containing an `Origin` header is rejected and no CORS allow headers are returned. Submit the public form to your own website server, then forward it to LeadHome. This prevents the bearer token from being exposed to visitors.

## Next.js route-handler example

```ts
// app/api/contact/route.ts on the external website
export async function POST(request: Request) {
  const form = await request.json();
  const response = await fetch(
    `${process.env.LEADHOME_URL}/api/inbound/forms`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LEADHOME_SOURCE_TOKEN}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(form),
    },
  );
  return Response.json(await response.json(), { status: response.status });
}
```

## curl

```bash
curl -X POST "https://your-leadhome.example/api/inbound/forms" \
  -H "Authorization: Bearer YOUR_SOURCE_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: contact-12345" \
  -d '{"name":"Jane Doe","email":"jane@example.com","phone":"+1 555 0100","company":"Acme","message":"Please call me","estimatedValue":2500}'
```

`name` is required. `email` must be valid when present, and `estimatedValue` must be nonnegative. LeadHome ignores external `userId`, `source`, and `status` values and always creates a `WEBSITE` / `NEW` lead for the token owner. Idempotency keys must be 8–200 characters and are retained for the life of the lead. Reusing a key for the same website source returns the original lead ID with `deduplicated: true`; keys are scoped per source.
