# Unstuck: Product Analyzer

Embedded Shopify app that finds underperforming products, diagnoses why they don't sell, applies fixes, measures the effect, and discounts only as a last step. Full plan: [docs/PLAN.md](docs/PLAN.md).

## Stack

- Next.js (App Router, TypeScript) + Tailwind CSS
- `@shopify/shopify-api` — token exchange, expiring offline tokens, webhook HMAC
- Shopify App Bridge (CDN script, loaded in `src/app/layout.tsx`)
- PostgreSQL on Supabase, accessed only through Prisma (`@prisma/adapter-pg`)

No other dependencies are added without the owner's approval.

## Setup

1. `cp .env.example .env` and fill in the values (Supabase → Connect for the connection strings).
2. `npm install` (also generates the Prisma client).
3. `npm run dev`, expose it with an HTTPS tunnel, and put the tunnel URL in `SHOPIFY_APP_URL` and in the Partner Dashboard app URL.

`SHOPIFY_API_KEY` is read at build time for the App Bridge meta tag, so it must be set when running `npm run build`.

## How it works

- **Auth:** App Bridge adds a session token to every `fetch` from the embedded UI. `src/lib/auth.ts` verifies it and, on first use, exchanges it for an expiring offline token (refreshed automatically). Tokens are encrypted at rest (`src/lib/crypto.ts`).
- **Webhooks:** one endpoint, `/api/webhooks`. App, order, product and inventory topics are registered per shop by the initial sync (`src/lib/sync/webhooks.ts`). The compliance topics `customers/data_request`, `customers/redact`, `shop/redact` must be set to this URL in the Partner Dashboard. Invalid HMAC returns 401.
- **Framing:** `src/proxy.ts` sets `frame-ancestors` to the shop and Shopify Admin.

## Database

Schema: `prisma/schema.prisma`. Migrations: `prisma/migrations`.

- New migration: change the schema, then `npm run db:migrate`.
- Apply in production: `npm run db:deploy`.

All tables have Row Level Security enabled with no policies, which blocks Supabase's public Data API. The app connects as the `postgres` role through Prisma, which is not affected.

## Billing

Plans are defined in `src/lib/plans.ts` and charged through Shopify Billing (14-day trial on paid plans). The plans page is `/plans`. Outside production all charges are test charges; in production only if `SHOPIFY_BILLING_TEST=true`. One trial per shop (`shops.trial_started_at`).

## Tests

`npm test` runs `node:test` on `src/**/*.test.ts`.

## Background jobs

Postgres-backed queue in `src/lib/jobs/`. Register a handler in `registry.ts` (and add it to `nightlyJobs` for a nightly run), then `enqueue({ type, shopId })`.

- Always-on server: set `JOBS_WORKER=true`; the worker starts with the Next.js server.
- Or call `POST /api/jobs/run` every minute with `Authorization: Bearer $CRON_SECRET`.
