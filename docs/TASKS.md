# Tasks

Built from `docs/PLAN.md`. One task = one branch (named as below) = one PR into `staging`.
Status: `todo` · `doing` · `done` · `blocked`.

## Decisions needed (block the tasks marked 🔒)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Hosting for app + background jobs | One always-on Node host (Railway or Render) |
| D2 | Background jobs / scheduler | Start with cron + a jobs table in Postgres (no Redis); move to Redis/BullMQ only if needed |
| D3 | UI kit | Tailwind only (owner rule). Risk: "Built for Shopify" expects Polaris look |
| D4 | Email for weekly digest | Resend, later (Phase 2) |
| D5 | Unit tests | `node:test` (built into Node, no package) |
| D6 | Claude API | Call with `fetch`, no SDK; needs an API key |

## Phase 0 · Foundation

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| — | Scaffold, Shopify auth, webhooks, DB schema | Merged in PR #1 | done |
| `dev-store-test` | Connect a dev store, fill `.env`, install the app | Home page shows "Connected to …"; uninstall marks the shop | todo (needs owner: Partner app + credentials) |
| `billing` | Shopify Billing: Free/Starter/Growth/Pro, 14-day trial, plan stored on `shops`, upgrade/downgrade page | Subscribe, change plan and cancel work on the dev store (test charges) | todo |
| `shopifyql-spike` | Query `shopifyqlQuery` for per-product `view_sessions`, cart and purchase rates; find the scope | Script returns 90 days of views per product; scope written in PLAN | todo |
| `ci-deploy` 🔒D1 | GitHub Actions (typecheck + build + tests), deploy `staging` and `main` | Push to `staging` deploys staging automatically | blocked |

## Phase 1 · Analyze

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `jobs` 🔒D2 | Background job runner (cron endpoint + jobs table, retries, per-shop lock) | A job can be queued, retried and scheduled nightly | blocked |
| `initial-sync` | Bulk operations: products, variants, inventory; 60 days of orders (no customer data); `sync_state` + progress bar | 2,000-product store synced in < 10 min | todo |
| `views-sync` | ShopifyQL views/cart/purchase sessions per product per day → `product_daily_metrics` | 90 days of view data stored | todo |
| `live-sync` | Webhooks `orders/create`, `products/update`, `inventory_levels/update` | Rows update within minutes | todo |
| `scoring` | Metrics (sell-through, days of cover, stock value, trend), statuses, money at stake; unit tests | Tests pass for every status rule and weight | todo |
| `daily-metrics` | Nightly job in store timezone: snapshot + re-score | Runs nightly; statuses refreshed | todo |
| `settings` | Thresholds, margin floor, max discount, exclusions; change re-scores | Re-score within 1 minute | todo |
| `dashboard` | "Money stuck in stock", products by status, top 10 to act on | Value visible on first screen, no setup | todo |
| `product-page` | Per-product metrics, 30/60/90 trend, last sale | Numbers within 2% of Shopify reports | todo |

## Phase 2 · Act and measure

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `diagnosis-rules` | 7 v1 rules with evidence | Every reason links to its data | todo |
| `ai-diagnosis` 🔒D6 | Claude explains reasons, JSON output, cached, `ai_usage` logged | No reason without evidence; usage capped by plan | blocked |
| `fix-center` | Drafts (title, description, SEO, image order, collection), approve, apply, snapshot, undo | Apply + undo leaves product exactly as before | todo |
| `rescue-plans` | Measurement window, traffic-adjusted baseline, verdicts; unit tests | Verdict shown with dates and numbers | todo |
| `markdown-engine` | Ladder 10/20/30%, floor check in code + DB constraint, audit log, price guard, auto-restore | No test ever prices below the floor | todo |
| `compare` | 2–4 products side by side | Loads in < 2 s | todo |
| `inbox` | In-app notifications | Actions appear in inbox | todo |
| `weekly-digest` 🔒D4 | Weekly email with top 5 actions | Email sent weekly, links work | blocked |
| `monthly-report` | Revenue recovered (documented formula), stock cleared, fixes | Formula shown next to each number | todo |
| `plan-limits` | Enforce products and AI diagnoses per plan | Limits block correctly; upgrade prompt shown | todo |

## Phase 3+ (mostly non-code)

Beta with 10 stores, privacy policy, protected customer data request, listing, screenshots, video, App Store submission.
