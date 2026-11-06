# Tasks

Built from `docs/PLAN.md`. One task = one branch (named as below) = one PR into `staging`.
Status: `todo` · `doing` · `done` · `blocked`.

## Decisions

| # | Decision | Status |
| --- | --- | --- |
| D1 | Hosting: Fly.io (app + worker process) | tentative |
| D2 | Background jobs: cron + jobs table in Postgres, no Redis | decided |
| D3 | UI: the owner's design in Tailwind (Polaris web components removed in Phase 3a); App Bridge for sign-in, the resource picker and billing | decided |
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
| `collection-reorder` | Move products by hand in the proposal, then save it to Shopify (only after the merchant confirms), with Undo; a collection changed in Shopify since needs a reload (or Undo anyway) | A saved order is in Shopify and can be undone | done |
| `collection-effect` | Products moved up to help them sell (hidden gems, slow movers, dead stock moved up 3+ places into the first 24) get a rescue plan measuring sales after the move vs before; the product page and the monthly report show it | A moved product shows its measurement and verdict | done |

## Phase 2g · Weekly plan

From the features workspace (Weekly plan). Decision: in the inbox for now; email later. On every plan (actions that need a higher plan lead to their upgrade note).

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `weekly-plan` | Every Monday (store time) the inbox gets "Your plan for this week": 3–5 actions picked by money at stake from the products that need attention: reorder (stock-out risk), start the markdown (when one is due), fix the page (the diagnosis's top reason), give a hidden gem a better place (Collections), or diagnose; products being measured or on a markdown are left out. A "This week" page lists them with a button to each product | A Monday plan with its actions is in the inbox and opens the page | done |
| `weekly-recap` | The plan's "Last week" part: rescue verdicts that came in (with the extra sales of the improved ones), markdowns started and finished, each with a button to the product | Last week's results show with the plan | done |

## Phase 2h · Rising stars

From the features workspace (Rising stars), picked by the owner as the next feature.

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `rising-stars` | The rule (nightly with the scores): at least 5 units in the last 30 days, 20%+ over the 30 days before (which had sales), converting at least as well as the store's median when visits are known; never dead stock, a slow mover or waiting for its season. A "Rising stars" card on the dashboard, a filter and mark in the product list, and on the product page the growth with suggested actions (stock when it runs out within 45 days at this pace, move it up in its collections, feature it on the home page) | A rising product shows on the dashboard, in the list and on its page with its actions | done |
| `rising-effect` | Measure sales after an action (e.g. moved up in a collection, featured) vs the period before | An action on a rising star shows its measurement | done |

## Phase 3a · Redesign (owner's design)

The owner's design (Unstuck App Design canvas) is followed as closely as possible: its own left menu (no Shopify admin sub-menu), Inter, a light grey ground with white cards, its status colors, buttons and tables, all in Tailwind (no Polaris components; App Bridge stays for sign-in, the resource picker and toasts). Pages appear in the menu only once their feature is built. Every later feature follows the design.

| Branch | Task | Done when | Status |
| --- | --- | --- | --- |
| `design-shell` | Design tokens (colors, Inter, radii) in Tailwind, the app shell with the design's left menu (built pages only, active page marked; stacks at phone width), shared UI pieces (page header, card, buttons, status pill, table styles); Shopify's sub-menu removed | Every page sits in the design's shell and menu | done |
| `design-dashboard` | Dashboard as in the design: catalog health, this week's moves, money stuck by status, next best move, rising stars, running out, top 10 | The dashboard matches the design with live data | done |
| `design-products` | Products list as in the design: search, sort, status filter pills with counts, the table (status pills, extra pill for rising stars / markdown, money, stock value, days, sell-through, vs market, last change) | The list matches the design | done |
| `design-product` | Product page as in the design (next step, numbers, daily sales, why it isn't selling, market price, variants, actions); sections for features not built yet are left out | The product page matches the design | done |
| `design-fix-center` | Fix center as in the design (description with AI, photos with AI, title and SEO, collections and price, from the diagnosis, history) | The fix center matches the design | done |
| `design-inbox` | Inbox with the weekly plan on top, as in the design (the separate "This week" page goes into it) | The inbox matches the design | done |
| `design-collections` | Collection Optimizer as in the design | Matches the design | done |
| `design-markdown-compare` | Markdown and Compare as in the design | Match the design | done |
| `design-results` | Results page (rescue plans and how the verdict is made), new in the menu | Matches the design | done |
| `design-account` | Monthly report, Plans, Settings and the first import as in the design; Polaris components removed | Match the design; no Polaris left | done |

## Phase 3b · Storefront: Page builder and A/B tests (owner's choice, 2026-11-05)

The owner chose: real A/B tests (half the visitors see B, at the same time) through a theme app extension; the page builder's first blocks: "Only X left", trust badges and size chart, "Often bought together", "Notify me when back"; both on the Growth plan. Nothing changes the theme's code; the merchant adds the app's block in the theme editor.

| Branch | What | Done when | Status |
|---|---|---|---|
| `storefront-extension` | Theme app extension (app block for the product page + app embed), app proxy with signature check, app-owned metafields, `write_app_proxy` scope | The block and the embed load on a product page; proxy requests with a bad signature are refused | done (code; the storefront check waits on the dev store) |
| `page-builder` | Page builder page as in the design: blocks on/off and order, settings per block, "Use for" (all, collections, products), preview, "Add to theme"; blocks "Only X left", trust badges, size chart, "Often bought together" (from orders) | The chosen blocks show on the store's product page as set | done (design look and storefront check wait on the owner and the dev store) |
| `notify-back-in-stock` | "Notify me when back": shoppers leave their email for a sold-out variant; an email goes out when it's back in stock (email service, owner's key); deleted on GDPR requests | A request on a sold-out size gets an email when stock returns | todo |
| `ab-tests` | A/B tests as in the design: title, description or photos; 50/50 per visitor, views and carts through the proxy (only with tracking consent), purchases from orders; chance B is better, stop at 95% or 30 days; "Use B now" applies it as a fix | A running test splits visitors and shows the chance; the winner applies in one click | done (design look and storefront check wait on the owner and the dev store) |
| — | Owner: `shopify app deploy` (extension, proxy, scopes), turn on the app embed and add the block in the theme editor of the dev store; run the migrations | Block visible on a product page of the dev store; an A/B test shows B to half the visitors | todo (owner) |
| — | Owner: an email service account for "Notify me when back" (Resend, from a verified domain) and `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` in `.env` | Test email arrives | todo (owner) |

## Phase 3c · The owner's next features (2026-11-06)

From the features list (Funksionet e Unstuck), in the order the owner chose. Each branch starts from the previous one (they can't be pushed from the working session; the owner pushes and merges them in order).

| Branch | What | Done when | Status |
|---|---|---|---|
| `page-builder-full` | The full product page as an app block ("Unstuck product page": photos, title, price, variant picker, quantity, buy buttons, description and the page builder's blocks), its parts on/off and in order with photo style, columns, Buy it now, vendor and sale badge set in the Page builder with a preview; suggested blocks per product (from status, diagnosis, stock, "often bought together") used in one click | A product template with the block shows the page as set in the app; a suggestion turns its block on for that product | done (storefront check waits on the dev store) |
| `launch-tracker` | New products followed through their first 7, 14 and 30 days: views, add-to-cart rate and sales against the store's; an early warning (no traffic, page problem) in the inbox at each checkpoint; a Launches page | A new product with views but few add-to-carts is flagged at day 7 with what to check | done |
| `bundles` | "Buy together −X%": a stuck product (dead stock, slow mover) paired with a product that sells well; a Shopify automatic discount (buy the bestseller, get the stuck product at X% off, never below the price floor; `write_discounts` scope); an offer block on the bestseller's page; sales of the stuck product through the bundle measured | A bundle runs as a Shopify discount and shows on the bestseller's page; its sales show in the app | done (needs `shopify app deploy` for the new scope; dev-store check pending) |

## v2 (not in v1)

AI diagnosis and AI drafts (Claude), weekly email digest.

## Phase 3+ (mostly non-code)

Beta with 10 stores, privacy policy, protected customer data request, listing, screenshots, video, App Store submission.
