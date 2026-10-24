# History

## 2026-10-24 · product-page
- `/products/[id]`: status and next action, stock, stock value, days of stock, last sale, money at stake, sell-through, 30-vs-previous-30 trend, units/revenue/views/view→cart/view→purchase for 30/60/90 days, 90-day units chart (single series, per-bar tooltip, validated color), variants with stock
- `GET /api/products/[id]` (shop-scoped); dashboard rows link to it
- Pure window/series logic with 4 unit tests; chart rendered and checked in a browser
- Open: views stay 0 until `views-sync`; "within 2% of Shopify reports" needs a dev store

## 2026-10-24 · dashboard
- Home page is now the catalog health dashboard (Polaris): "money stuck in stock" headline (stock value of dead stock and slow movers, estimate noted), products by status with stock value, top 10 to act on today with next action, money at stake and days of stock
- `GET /api/dashboard` reads each product's latest score (LATERAL index lookup, independent of other shops); scores now store `stock_value` and `cost_is_estimate` (migration applied to Supabase)
- The page checks again every 5 s until the first analysis is done
- Pure summary logic with 3 unit tests; scoring + dashboard query verified end to end on a local Postgres 16

## 2026-10-24 · daily-metrics
- Nightly `daily-metrics` job (just after midnight store time): full catalog refresh (repairs missed product/inventory webhooks, snapshot-aware), yesterday's closing stock into `product_daily_metrics.inventory_qty`, score history pruned to 90 days (newest kept), then `score-shop`
- Nightly jobs that find the shop's bulk query slot busy are queued again in 10 min instead of using up retries; a stage left "running" by a dead run is restarted, not resumed
- The order catch-up re-scores the shop; shops whose import failed are still re-scored nightly
- Verified snapshot and pruning SQL on a local Postgres 16; 1 new unit test

## 2026-10-24 · live-sync
- Webhooks (app, orders create/updated/cancelled, products create/update/delete, inventory levels) registered by their own job after install and nightly; order payloads limited to the fields we store (`includeFields`)
- New table `order_lines` (no customer data): daily sales are rebuilt from it under a per-shop lock (webhooks wait at most 3 s, then Shopify retries), so repeated, stale, concurrent and out-of-order webhooks stay correct; refunds and cancellations reduce sales
- Import snapshots: webhook data newer than the bulk query start is never overwritten or deleted by the import (orders and products)
- Orders older than the known history window are ignored; dead-stock history counts only known order days (grows with live sync)
- Product/inventory webhooks queue a single-product re-sync (paginated, under the API cost limit; cut-off variant lists never delete variants), which also rebuilds that product's sales
- Nightly catch-up re-reads orders changed since the last successful catch-up (minus 1 day), so outages are covered
- Verified on a local Postgres 16 (repeat, refund, stale replay, cancel, late product, 10 concurrent orders, import vs webhooks); 6 new unit tests
- Not yet tested against a real store (REST `current_quantity` after refunds and query costs to confirm)

## 2026-10-24 · initial-sync
- First request after (re)install queues `initial-sync` exactly once (install detected by an atomic insert/reactivation, safe with parallel requests)
- Job chain: shop currency + IANA timezone → products bulk query (variants, stock, cost, collections, media count, created date) → orders bulk query (last 60 days; date, cancellation, line items only — no customer data; revenue = current quantity × unit price after all discounts) → `score-shop`
- `sync-poll` job polls bulk operations every 10 s (max 1 h); results stored with bulk upserts (1,000 rows per statement); daily sales per product per local day replace the 60-day window, view columns untouched
- `sync_state` per step; a step that fails for good is marked "error" (products failing skips orders; orders failing still scores); home page shows progress and a "Try again" button
- Full product sync marks products deleted in Shopify as DELETED (audit log kept) and removes deleted variants; daily sales replaced in one transaction
- Retry is gated by a row lock (verified: 5 parallel retries start one import); a step stuck after a crash can be retried
- Open: `live-sync` must extend the order history window past 60 days in `score-shop`
- Verified the upsert SQL on a local Postgres 16 (re-sync updates, shop isolation, views kept); 5 unit tests for JSONL parsing and transforms
- Not yet tested against a real store (needs dev store credentials); requires `read_orders` and protected customer data approval for orders; `image_count` holds Shopify's media count (includes video/3D)

## 2026-10-24 · settings
- `/settings` page (Polaris): status thresholds, minimum margin, maximum discount, excluded collections and products (App Bridge resource picker; new column `settings.excluded_product_ids`, migration applied to Supabase)
- `GET/PUT /api/settings` with strict validation (field errors → 400); `GET /api/collections` from the Admin API
- Saving queues a `score-shop` job (first registered job handler), or pulls a pending one forward; the worker re-scores within seconds
- 4 unit tests for validation; percentages rounded to 2 decimals
- Open: `initial-sync` must store collection GIDs in `products.collections`; excluded product titles show once products are synced

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
