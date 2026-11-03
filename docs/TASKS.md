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
| `billing` | Shopify Billing: Free/Starter/Growth/Pro, 14-day trial, plan stored on `shops`, upgrade/downgrade page | Subscribe, change plan and cancel work on the dev store (test charges) | done (dev-store test pending) |
| `shopifyql-spike` | Query `shopifyqlQuery` for per-product `view_sessions`, cart and purchase rates; find the scope | Script returns 90 days of views per product; scope written in PLAN | done; owner runs the check page on the store |
| `ci-deploy` | GitHub Actions (build + tests), deploy `staging` and `main` | Push to `staging` deploys staging automatically (Fly.io, after D1 is final) | CI done; deploy waits on D1 |

## Phase 1 · Analyze

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `jobs` | Background job runner (cron endpoint + jobs table, retries, per-shop lock) | A job can be queued, retried and scheduled nightly | done |
| `initial-sync` | Bulk operations: products, variants, inventory; 60 days of orders (no customer data); `sync_state` + progress bar | 2,000-product store synced in < 10 min | done (dev-store test pending) |
| `views-sync` | ShopifyQL views/cart/purchase sessions per product per day → `product_daily_metrics` | 90 days of view data stored | done (dev-store test pending) |
| `code-review` | Senior review of code and organization; fix bad practices | Build, tests and QA pass; report to owner | done |
| `customer-fixes` | Fix what the customer test found | Customer test passes again | done |
| `live-sync` | Webhooks `orders/create`, `products/update`, `inventory_levels/update` | Rows update within minutes | done (dev-store test pending) |
| `scoring` | Metrics (sell-through, days of cover, stock value, trend), statuses, money at stake; unit tests | Tests pass for every status rule and weight | done |
| `daily-metrics` | Nightly job in store timezone: snapshot + re-score | Runs nightly; statuses refreshed | done (dev-store test pending) |
| `settings` | Thresholds, margin floor, max discount, exclusions; change re-scores | Re-score within 1 minute | done |
| `dashboard` | "Money stuck in stock", products by status, top 10 to act on | Value visible on first screen, no setup | done (dev-store test pending) |
| `product-page` | Per-product metrics, 30/60/90 trend, last sale | Numbers within 2% of Shopify reports | done (dev-store test pending) |

## Phase 2 · Act and measure

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `diagnosis-rules` | 7 v1 rules with evidence | Every reason links to its data | done |
| `fix-center` | Merchant edits title, description, SEO, image order, collection with rule hints; apply, snapshot, undo | Apply + undo leaves product exactly as before | done (dev-store test pending) |
| `rescue-plans` | Measurement window, traffic-adjusted baseline, verdicts; unit tests | Verdict shown with dates and numbers | done |
| `markdown-engine` | Ladder 10/20/30%, floor check in code + DB constraint, audit log, price guard, auto-restore | No test ever prices below the floor | done (dev-store test pending) |
| `compare` | 2–4 products side by side | Loads in < 2 s | done (dev-store test pending) |
| `inbox` | In-app notifications | Actions appear in inbox | done (dev-store test pending) |
| `monthly-report` | Revenue recovered (documented formula), stock cleared, fixes | Formula shown next to each number | done (dev-store test pending) |
| `plan-limits` | Enforce products and diagnoses per plan | Limits block correctly; upgrade prompt shown | products + features done; diagnoses limit waits on owner |
| `ui-redesign` | Redesign Catalog health, Inbox, Monthly report and Plans (Polaris + Tailwind) | Owner approves the look on the dev store | done (dev-store look pending) |

## Phase 2b · Diagnosis: market price

From the features workspace (Diagnosis). Decision: market price from **A** Google Merchant Center + **C** competitor links. Plan placement proposed as Starter (owner to confirm).

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `competitor-prices` | Up to 5 competitor links per product; price read when added and every night (https only, public addresses only, 10 s, size cap); "Market price" section on the product page | A link shows its price or a readable error; no request reaches a private address | done (test on dev store) |
| `market-price-rule` | Diagnosis rule "above the market price" (>10% medium, >25% high, same currency only); threshold in Settings; "vs market" column in the product list | The rule shows its evidence with the market price and its source | done |
| `google-market-price` | Connect Google Merchant Center in Settings (OAuth, account choice); nightly price-competitiveness report mapped to variants; Google benchmark in the "Market price" section, the diagnosis (when no competitor links) and the product list | Benchmarks appear for products Google can compare (with a GTIN) that sell on Google through Shopify's Google & YouTube app; Settings shows the connection, the last read and its errors | done (real test needs the owner's Google credentials) |
| — | Owner: Google Cloud project with the Merchant API enabled; OAuth client (Web application) with redirect URI `<SHOPIFY_APP_URL>/api/google/callback`; `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`; register the Cloud project once with your own Merchant Center account (Merchant API developer registration) | Credentials in `.env`; Settings shows "Connect Google Merchant Center" | todo (owner) |
| — | Owner: Google verification of the `content` scope before the App Store | Verified | todo (owner, before App Store) |
| — | Open questions: diagnosis every night with the main reason in the top 10; keywords beyond English; monthly diagnosis limit | Owner decides | waits on owner |

## Phase 2c · Seasonal products

From the features workspace (Seasonal products). Decision: the merchant marks seasons with a tag now; detection from sales history later (needs `read_all_orders`). All plans (it corrects statuses).

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `seasonal-tags` | Product tags in the sync; season from a product tag (`season:nov-feb`, `season:11-2`, `season:winter`) or from a collection marked seasonal in Settings; season shown on the product page | A tagged product shows its season and whether it's in season | done |
| `seasonal-status` | New status "Seasonal": out of season (and the first 30 days of the season) a product isn't dead stock or a slow mover and gets no markdown; days without a sale count from the season's start | A jacket unsold since spring shows "Seasonal · season starts in November", not dead stock | done |
| `seasonal-reminders` | Inbox reminder 30 days before a season starts; when a season ends with stock left, an inbox note and an end-of-season markdown proposal for 30 days | The reminder and the end-of-season markdown appear once per season | done |
| — | Seasons from sales history (12 months of orders) | After Shopify approves `read_all_orders` | waits on owner |

## Phase 2d · Returns

From the features workspace (Returns). Decisions: a product's return rate is high at twice the store's average (at least 5 units returned); return reasons are read with the new `read_returns` scope (merchants approve it once).

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `returns-sync` | `read_returns` scope; refunded units per order line (not cancellations before shipping) and money refunded, from the nightly read and order webhooks; return reasons from Shopify returns | Refunds and reasons of the last 60 days are stored per product | done (request costs to confirm on the dev store) |
| `returns-diagnosis` | Diagnosis reason "returned often": return rate vs the store's average (2×, min. 5 units), the most common reason, a fix hint by reason; returns on the product page | A product returned twice as often as the store shows the reason with its numbers | done |
| `returns-report` | Monthly report: money refunded for returns and the top return reasons | The report shows what returns cost that month | done |
| — | Owner: deploy the new scope (`shopify app deploy`) so merchants are asked to approve `read_returns` | Scope approved on the dev store | todo (owner) |

## Phase 2e · Fix center: AI descriptions and photos

From the features workspace (Fix center). Decisions: descriptions and SEO with Claude Opus 5.5 (`@anthropic-ai/sdk`); photos with OpenAI gpt-image; descriptions from Starter (30 / 150 / 500 a month on Starter / Growth / Pro), photos from Growth (50 / 200 a month on Growth / Pro).

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `ai-descriptions` | "Write with AI" in the Fix center (highlighted when the diagnosis finds a short, thin or copied description): from the title, type, variants, current description and photos, in the store's language; facts the AI doesn't know come back as [fill in: …]; also SEO title and meta description; the merchant edits and applies (with Undo); monthly limit per plan in `ai_usage` | A draft appears in the editor, applies to Shopify and can be undone; the limit stops at the plan's number | done |
| `ai-photos` | "Create photo with AI" in the Fix center when the diagnosis finds few photos: from an existing photo (clean background, new scene); the merchant previews and approves before it goes to Shopify (with Undo); a product with no photo asks for one first; photos marked as AI-made; monthly limit per plan | An approved AI photo is on the product in Shopify and can be undone | done |
| — | Owner: `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in `.env` | Keys in `.env` | todo (owner) |

## Phase 2f · Collection Optimizer

From the features workspace (Collection Optimizer). Decision: the app proposes the order and asks for confirmation; once confirmed, it saves it in Shopify itself. Only collections sorted "Manually" in Shopify. On the plan as the fix center (Starter and up).

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `collection-order` | Ordering rule by status: bestsellers first (in stock; about-to-run-out ones after them), then hidden gems, then products that need sales (slow movers, dead stock with stock); the rest keep their order; page problems (fix the page first), out-of-season and sold-out products last. A Collections page lists the manually sorted collections and shows each one's proposed order with the reason per product | The proposed order shows for a manual collection, with a reason for each product | done |
| `collection-reorder` | Move products by hand in the proposal, then save it to Shopify (only after the merchant confirms), with Undo; a collection changed in Shopify since needs a reload (or Undo anyway) | A saved order is in Shopify and can be undone | doing |
| `collection-effect` | Products moved up get a rescue plan measuring sales after the move vs before; the product page and the monthly report show it | A moved product shows its measurement and verdict | todo |

## v2 (not in v1)

AI diagnosis and AI drafts (Claude), weekly email digest.

## Phase 3+ (mostly non-code)

Beta with 10 stores, privacy policy, protected customer data request, listing, screenshots, video, App Store submission.
