# LeadHome

LeadHome is a Next.js CRM with credentials authentication, user-scoped lead
management, immutable lead activity, and secure server-to-server website-form
ingestion.

## Local setup

Requirements: Node.js, npm, and PostgreSQL.

1. Copy `.env.example` to `.env.local`.
2. Set `DATABASE_URL` and generate a strong `AUTH_SECRET`.
3. Install dependencies with `npm install`.
4. Apply migrations with `npm run db:migrate:deploy`.
5. Generate the Prisma client with `npm run db:generate`.
6. Start the app with `npm run dev`, then open
   [http://localhost:3000](http://localhost:3000).

`INBOUND_RATE_LIMIT_PER_MINUTE` is optional and defaults to 20 accepted
requests per website source and IP in each 60-second window. All configuration
is server-only; no `NEXT_PUBLIC` variables are required.

On Windows, a running Next.js process can lock Prisma's query-engine DLL. Stop
the development server before retrying `npm run db:generate` if generation
reports `EPERM`.

## Validation and database operations

```bash
npm run validate
npm run build
npm run db:validate
npm run db:migrate:deploy
```

`npm run validate` runs Prisma validation, ESLint, TypeScript, and the full test
suite. Production deployments must run migrations before serving a version
that depends on them. Vercel builds continue to generate Prisma through the
`build` script and `postinstall`.

## Operational documentation

- [Website form ingestion](docs/inbound-forms.md): source tokens, payloads,
  rate limiting, CORS behavior, and idempotency.
- [Lead activity timeline](docs/lead-activity-timeline.md): activity creation,
  legacy leads, ordering, and deletion behavior.
