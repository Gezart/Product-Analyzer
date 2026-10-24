# Tasks

Built from `docs/PLAN.md`. One task = one branch (named as below) = one PR into `staging`.
Status: `todo` · `doing` · `done` · `blocked`.

## Decisions

| # | Decision | Status |
| --- | --- | --- |
| D1 | Hosting: Fly.io (app + worker process) | tentative |
| D2 | Background jobs: cron + jobs table in Postgres, no Redis | decided |
| D3 | UI: Polaris web components from Shopify CDN (no npm package) + Tailwind for layout gaps | decided |
| D4 | Weekly email digest | moved to v2 |
| D5 | Unit tests: `node:test` | decided |
| D6 | No AI in v1: diagnosis is rule-based; fix center has merchant-written edits with rule hints, snapshot and undo | decided |

## Phase 0 · Foundation

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| — | Scaffold, Shopify auth, webhooks, DB schema | Merged in PR #1 | done |
| `dev-store-test` | Connect a dev store, fill `.env`, install the app | Home page shows "Connected to …"; uninstall marks the shop | todo (needs owner: Partner app + credentials) |
| `billing` | Shopify Billing: Free/Starter/Growth/Pro, 14-day trial, plan stored on `shops`, upgrade/downgrade page | Subscribe, change plan and cancel work on the dev store (test charges) | todo |
| `shopifyql-spike` | Query `shopifyqlQuery` for per-product `view_sessions`, cart and purchase rates; find the scope | Script returns 90 days of views per product; scope written in PLAN | todo |
| `ci-deploy` | GitHub Actions (typecheck + build + tests), deploy `staging` and `main` | Push to `staging` deploys staging automatically (Fly.io, after D1 is final) | todo |

## Phase 1 · Analyze

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `jobs` | Background job runner (cron endpoint + jobs table, retries, per-shop lock) | A job can be queued, retried and scheduled nightly | todo |
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
| `fix-center` | Merchant edits title, description, SEO, image order, collection with rule hints; apply, snapshot, undo | Apply + undo leaves product exactly as before | todo |
| `rescue-plans` | Measurement window, traffic-adjusted baseline, verdicts; unit tests | Verdict shown with dates and numbers | todo |
| `markdown-engine` | Ladder 10/20/30%, floor check in code + DB constraint, audit log, price guard, auto-restore | No test ever prices below the floor | todo |
| `compare` | 2–4 products side by side | Loads in < 2 s | todo |
| `inbox` | In-app notifications | Actions appear in inbox | todo |
| `monthly-report` | Revenue recovered (documented formula), stock cleared, fixes | Formula shown next to each number | todo |
| `plan-limits` | Enforce products and diagnoses per plan | Limits block correctly; upgrade prompt shown | todo |

## v2 (not in v1)

AI diagnosis and AI drafts (Claude), weekly email digest.

## Phase 3+ (mostly non-code)

Beta with 10 stores, privacy policy, protected customer data request, listing, screenshots, video, App Store submission.
