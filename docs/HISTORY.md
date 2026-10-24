# History

## 2026-10-24 · settings
- `/settings` page (Polaris): status thresholds, minimum margin, maximum discount, excluded collections and products (App Bridge resource picker; new column `settings.excluded_product_ids`, migration applied to Supabase)
- `GET/PUT /api/settings` with strict validation (field errors → 400); `GET /api/collections` from the Admin API
- Saving queues a `score-shop` job (first registered job handler), or pulls a pending one forward; the worker re-scores within seconds
- 4 unit tests for validation; percentages rounded to 2 decimals
- Open: `initial-sync` must store collection GIDs in `products.collections` for exclusions to match

## 2026-10-24 · ci
- GitHub Actions on every PR and on pushes to `staging`/`main`: `npm ci`, build, typecheck, tests (Node 22)
- Verified the steps in a clean copy without any env vars
- Open: deploy to Fly.io waits for hosting decision D1

## 2026-10-24 · jobs
- Background job queue in Postgres (`jobs` table), no Redis: enqueue with dedupe key, retries with backoff (30s → 1h, 5 tries), crashed-worker locks released after 10 min
- One running job per shop, enforced by a partial unique index; claims use `FOR UPDATE SKIP LOCKED` so several workers can run
- Nightly scheduling in each store's timezone (DST-aware), via `nightlyJobs` in `src/lib/jobs/registry.ts`
- Runs in-process on the always-on server (`JOBS_WORKER=true`, `src/instrumentation.ts`) or via `POST /api/jobs/run` with `CRON_SECRET`
- Uninstall drops the shop's queued jobs; jobs of uninstalled shops are not run
- Handlers time out after 5 min (lock expires at 10), completion is guarded by the worker's lock, SIGTERM/SIGINT hand the running job back (best effort)
- Nightly scheduling runs at most every 10 min; DST gaps/overlaps handled
- Verified the claim SQL on a local Postgres 16: 10 parallel workers never ran 2 jobs for one shop; 11 unit tests for scheduling and retries
- Open: handlers are registered by later tasks (`daily-metrics`, sync jobs); `initial-sync` must store Shopify's `ianaTimezone` in `shops.timezone` (otherwise UTC)

## 2026-10-24 · scoring
- `src/lib/scoring.ts`: metrics (sell-through, days of cover, stock value, trend, conversion), statuses and money at stake, store-relative thresholds, editable defaults
- `src/lib/score-shop.ts`: scores a shop's active products from `product_daily_metrics` and writes `product_scores`
- 27 unit tests (`npm test`): every status, weight and precedence
- Dead stock needs proof, capped at product age (`products.shopify_created_at`, migration applied to Supabase)
- Stock value per variant; negative stock counts as 0; invalid thresholds fall back to defaults
- Inactive/excluded products get an "excluded" score row so old scores don't linger
- Open: `scoreShop` is called by the `daily-metrics` and `settings` tasks; `initial-sync` must fill `products.shopify_created_at`

## 2026-10-24 · billing
- Shopify Billing with Free/Starter/Growth/Pro, 14-day trial, test mode via `SHOPIFY_BILLING_TEST`
- `/plans` page (Polaris web components), `/api/billing` to read/change plan
- `app_subscriptions/update` webhook re-syncs the plan; App Bridge nav menu
- One trial per shop (`shops.trial_started_at`, migration applied to Supabase); duplicate plan → 409; bad input → 400
- Test charges always outside production; production only if `SHOPIFY_BILLING_TEST=true`
- First unit tests (`npm test`, node:test)
- Open: not yet tested on a dev store; plan limits enforced in task `plan-limits`
