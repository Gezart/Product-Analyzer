# History

## 2026-10-25 · views-sync
- New `views-sync` job: daily view, cart and purchase sessions per product from ShopifyQL into `product_daily_metrics` — 90 days once the first import is done (the analysis doesn't wait for it), then the last 7 days after each nightly catalog refresh; a re-score follows (also when views are unavailable), so conversion statuses (page problem, hidden gem) use them
- Exact dates in every query, read one week at a time; an answer that is refused, has rows but no product views, or looks cut off (exactly 1,000, 10,000 or 100,000 rows when more were possible) stores nothing
- Replaces the view columns over the range read (days without views become 0) and never touches sales or stock; one transaction (2,000 products × 90 days: ~24 s locally)
- Tries the query that worked last time first; missing access (scope or protected customer data) or an unusable answer is recorded on the "views" sync step and not retried — the app keeps working on sales alone; network errors retry without touching that step; nothing runs before the first import is done; a reinstall reads the 90 days again
- 7 unit tests for ranges, queries and parsing; checked on a local Postgres 16 with ShopifyQL stubbed (first run, nightly, refused/junk/cut-off answers, network error, access denied)
- Open: confirm on the dev store with the ShopifyQL check page (query syntax, access, whether answers are capped)

## 2026-10-25 · shopifyql-spike
- Scope: `shopifyqlQuery` (GraphQL Admin API 2025-10+) needs `read_reports` — added to `shopify.app.toml` and `.env.example`, written in PLAN (Shopify also lists Level 2 protected customer data for it); after the scope change the app gets a new token once the merchant approves (no reinstall)
- ShopifyQL check page (development only, link at the bottom of Settings → `/dev/shopifyql`): shows the granted scopes, the API's ShopifyQL types, and what each candidate query for 90 days of daily views per product returns (rows, products, dates, sample) — the owner runs it on the dev store and sends the result
- Candidate queries use the products dataset (`view_sessions`, `view_cart_sessions`, `view_cart_checkout_purchase_sessions` by product and day); parsing handles both row formats
- 3 unit tests; not run against Shopify from here (no store access, shopify.dev blocked in this environment)
- Open: owner runs the check page on `gezart-test-store-plus` (after `shopify app deploy` for the new scope)

## 2026-10-25 · dev-store-test (customer test fixes)
- Customer test (local, Shopify stubbed) for "the app shows no data": the job worker was off (`JOBS_WORKER=false` in `.env.example`), so the store import never ran; now `true` by default and in the README
- Empty store: the dashboard now says there are no active products instead of waiting forever
- Gift cards and other products sold without stock are no longer flagged "Stock-out risk"
- Job failures are logged in the server terminal; a failed import says "The store import stopped"
- No dark theme from the Next.js template (Shopify Admin is light); settings scrolls to the save result; phone: the sales chart keeps a readable size and a tap shows the day; small text fixes
- Open: App Bridge expects to be the first script (Next.js adds its scripts first) — works in practice so far, to watch on the store; Plans page needs Shopify to load (not testable here)
## 2026-10-24 · plan-limits
- Products analyzed per plan (Free 25, Starter 250, Growth 2,000, Pro unlimited): over the limit, products analyzed before keep their place and free places go to the products with the most money in stock (so the choice doesn't flip night to night); the rest get "Over plan limit" (no diagnosis, fixes or markdown; new products too once the places are taken) and the dashboard says how many and links to Plans; any plan change, including a downgrade to Free, re-scores right away (after the first import)
- Features by plan: applying fixes (and so rescue plans) and approving markdowns from Starter; Compare and monthly reports from Growth. Blocked actions return 403 with the plan to upgrade to, and the pages show "included from the X plan · See plans"
- Kept on every plan, for safety: fix history and undo, cancelling a running markdown; running markdowns keep their approved steps after a downgrade (owner can change this)
- Monthly reports are only stored (and announced) for shops whose plan includes them
- 2 unit tests; scoring with the limit and every gate checked on a local Postgres 16
- Open: the monthly limit on diagnoses waits on the owner's decision (v1 diagnosis is rule-based, no AI)

## 2026-10-24 · dev-store-test (setup)
- `shopify.app.toml` (embedded app, scopes, Shopify-managed install, privacy webhooks to `/api/webhooks`) and `shopify.web.toml` (`npm run dev`) so the app can run on a dev store with `shopify app dev`
- The app also reads the values the Shopify CLI passes (`SCOPES`, `HOST`); the dev server accepts requests through the tunnel (`allowedDevOrigins`)
- README: step-by-step setup with the Shopify CLI (through `npx`, no new dependency)
- Open: the owner links the app (`client_id`) and installs it on the dev store; then the end-to-end test on the store

## 2026-10-24 · monthly-report
- Monthly report (`/reports`, in the app menu): every month since install plus this month so far; the formula is shown next to each number and on every row (with the baseline dates)
- Revenue recovered = actual revenue − baseline daily revenue × days, floored at 0, per product and period (PLAN formula). Rescue plans that improved count with their whole measurement window in the month it ends (baseline = their window before the fix); markdowns count day by day in each month (baseline = the 30 days before, within known history; without known history nothing counts as recovered); a day is counted once per product, across months too
- Stock value cleared = units sold in those periods × unit cost (50% of the sale price where no cost is set, marked as estimated); products rescued = distinct products whose window ended in the month as "improved"; fixes applied in the month with their current effect (their rescue plan's verdict)
- The page always rebuilds from current data; each finished month is also stored once on the 2nd (with its inbox item, "Your October report is ready: €X recovered"); months before the install are skipped
- 6 unit tests; report build, storing and the API checked on a local Postgres 16 (under 100 ms)
- Open: Growth-plan gating comes with `plan-limits`; share button and email/PDF reports are later

## 2026-10-24 · inbox
- In-app inbox (`/inbox`, in the app menu; "N new in your inbox" on the home page): newest first, unread marked, opening an item marks it read and goes to the action, "Mark all as read"
- Items: first analysis ready (with counts by status), products that newly need attention after a scoring run (one summary per run), rescue plan verdicts, and the markdown events (floor reached, paused, unsold at the end, restore failed, price below floor)
- Text is built when the inbox is read (`src/lib/notifications.js`), from the type and a small `data` field (new column, migration); a failed notification never breaks the job that sent it
- Read items are deleted 90 days after reading, unread ones after a year (nightly, never failing the refresh)
- 2 unit tests; scoring → inbox and the inbox API checked on a local Postgres 16
- Open: the weekly email digest is v2 (D4)

## 2026-10-24 · compare
- Compare page (`/compare`, in the app menu and from each product page): pick 2–4 products with Shopify's product picker, side by side over the last 30/60/90 days
- Rows: units, revenue, views, conversion (view → purchase), price (with compare-at), margin, stock, stock value, stock age, page quality; the best value per row is highlighted
- Margin = (price − unit cost) ÷ price, averaged over variants with a cost (shows how many have one); stock age = days since the last sale (with no sale: the product's age, or "over N days" when older than the known history); page quality = share of the diagnosis's per-product page checks that pass (0–100; text and SEO checks only once that page data is synced), with the failed checks listed; a product that never sold isn't highlighted as the freshest stock
- Picked products and the window are kept in the URL; windows longer than the known order history are flagged
- 5 unit tests; API checked on a local Postgres 16 (under 150 ms cold, under 10 ms warm)
- Open: Growth-plan gating comes with `plan-limits`; views and conversion show once `views-sync` is connected

## 2026-10-24 · javascript
- Code converted from TypeScript to JavaScript (owner's request): React files are `.jsx`, the rest `.js`; types removed, comments and formatting kept (docs of removed types moved next to the code that uses them)
- `typescript` and `@types/*` removed; `tsconfig.json` replaced by `jsconfig.json` (only the `@/*` path alias); `package.json` is `"type": "module"`
- CI and the agent instructions now run build + tests (no typecheck step); CLAUDE.md, README and PLAN say JavaScript
- Build passes without TypeScript, 119/119 tests, Prisma schema valid; every file checked for names used but not defined (none)
- With no typecheck, nothing in CI catches an undefined name; a linter (ESLint) would, but it is a new dependency and needs the owner's OK
- Note: the Prisma client generated at build time (`src/generated/prisma`, not committed) is still TypeScript; Next.js compiles it

## 2026-10-24 · markdown-engine
- Markdown ladder 10% → 20% → 30% with a compare-at price, one step every 14 days, proposed when a rescue plan ends with no change or the product is dead stock; preview from live Shopify prices and costs, merchant approves the exact schedule
- Money rule: never below cost × (1 + minimum margin) (rounded up to the cent), never more than the max discount (rounded so it can't be exceeded); variants without a unit cost are never discounted
- Enforced three times: in the ladder code (20,000-case property test), right before each write (against the live cost and today's max discount; a price is never raised above the original), and by the database (CHECK on `price_changes`; prices are logged as pending before Shopify is called, so a refused row means no write)
- Every price change is logged (`price_changes`: old/new price and compare-at, floor, reason, status); a failed or unanswered write is re-read from Shopify and each row marked applied or failed (if that read fails too, the row stays pending and the next run settles it); after 3 failed runs in a row the plan pauses; if Shopify refuses step 1 at approval, the plan fails and the merchant sees why
- Stops when half the starting stock has sold or the ladder is done (paused plans too), then restores or holds the price (new setting); if the merchant changes a price mid-plan, the plan pauses instead of overwriting it; cancel restores only prices the app set; no plan without stock
- Plan runner (hourly) applies steps; price guard after each run and daily raises any plan price below its live floor (daily also prices held at the end of a plan) and notifies once per problem; one running plan per product (unique index); runner, guard and cancel never overlap on one plan (advisory lock)
- 22 unit tests (incl. a property test with changed live costs and margins); DB constraints verified on a local Postgres 16
- Not yet tested against a real store; "bundle or Outlet" for unsold stock is v2 (a notification is created)

## 2026-10-24 · rescue-plans
- Applying a fix starts the product's measurement window today (a fix during an open window restarts it and joins the same plan; the baseline stays before the first fix); undoing all of a plan's fixes cancels it
- Window ends on the first day with 150 views or at 30 days, never before 14 (decided by the data, not by when the runner runs); under 50 views it is extended once (to 60 days), then "not enough data"; windows close only after the 04:00 order catch-up
- Baseline = the same number of days just before the fix (cut at the start of known history or the product's creation, and scaled to the window), with expected units scaled by the rest of the store's traffic change — only with enough volume (30 units / 300 views per period) and capped at ×0.5–×2
- Verdict: improved (conversion +20% and more units than expected), worse (conversion −20%), no change; exactly ±20% counts; without view data, units vs expected units (±20%)
- Hourly `rescue-runner` job (new hourly scheduling, guarded against a restart in between); product page shows the window, then the verdict with dates, numbers and next step, and a one-click "Undo the fixes" when worse
- 13 unit tests for the window logic; runner verified end to end on a local Postgres 16
- Owner decision pending: the traffic-scaling limits (volume minimum, ×0.5–×2 cap) are defaults in `src/lib/rescue.ts`

## 2026-10-24 · fix-center
- Fix center on the product page: merchant edits title, description (HTML), SEO title/meta, image order and manual collections, with hints from the diagnosis; "Apply to Shopify" is the approval
- Each apply reads the current state live from Shopify as the undo snapshot, writes via the Admin API (productUpdate, productReorderMedia, collectionAdd/RemoveProducts, waiting for async jobs), then stores what Shopify actually saved
- Undo writes the snapshot back; if the product changed since the fix, undo asks before overwriting ("Undo anyway")
- Image reorder moves verified for every order of up to 6 images, including apply then undo
- Safety: apply refuses if Shopify changed since the page loaded; one change per product at a time; undo claims the fix first; a write that fails part way (or with an unknown outcome) stays undoable, and so does an attempt interrupted by a crash; unsaved edits are kept when an apply fails; async Shopify jobs not done in time are reported as still finishing
- Fix history per product with status (applied / undone / failed + error); new `fixes` columns (migration)
- 5 unit tests for validation, state comparison, media moves and collection diffs
- Not yet tested against a real store (incl. clearing SEO with ""); smart (automated) collections are shown but can't be edited; re-adding to a manually sorted collection puts the product at the end; plan gating comes with `plan-limits`

## 2026-10-24 · diagnosis-rules
- Rule-based diagnosis (v1, no AI): price > 25% above peers (the narrowest product type or collection with enough peers; catch-all groups over half the store skipped; product itself excluded; ≥ 3 peers), fewer than 3 images, description < 80 words / missing size, material or use / copied from another product, missing SEO title or meta description, broken size run (variants that sell when out of stock don't count), no collection or only quiet collections, high add-to-cart but low purchase with ≥ 5 carts (store-level)
- Every reason carries its numbers (evidence + data) and links to the product page section that shows them; ordered by severity
- `GET /api/products/[id]/diagnosis`; a `diagnoses` row is stored only when the reasons or the items they name change (`rules-v1`); duplicates found in SQL
- Sync now stores the plain-text description, SEO title/description and whether a variant sells when out of stock (migration); rows synced before that get no description/SEO reasons until the nightly catalog refresh fills them; product page shows a "Product page" quality section
- 13 unit tests; verified end to end on a local Postgres 16
- Open: traffic rules need `views-sync`; the "first image is a product shot" check needs AI (v2); keyword checks are English only

## 2026-10-24 · product-page
- `/products/[id]`: status and next action, stock, stock value, days of stock, last sale, money at stake, sell-through, 30-vs-previous-30 trend, units/revenue/views/view→cart/view→purchase for 30/60/90 days, 90-day units chart (single series, per-bar tooltip, validated color), variants with stock
- `GET /api/products/[id]` (shop-scoped); dashboard rows link to it
- Windows longer than the known order history are flagged (only N days known) and the chart shades days before history starts; stock, its value and days of stock are live; draft/archived/excluded products show "Not analyzed"
- Scoring now uses the store's local date for "today" (same calendar as the daily metrics)
- Pure window/series/trend logic with 6 unit tests; chart rendered and checked in a browser
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
