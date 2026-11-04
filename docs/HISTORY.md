# History

## 2026-11-04 · design-results
- New Results page in the menu (after Inbox), as in the owner's design: "Every fix and collection order is measured. Here is what worked."; how many are measuring now and the last 90 days' Improved, No change and Worse; the rescue plans with the product, what changed and when, the window as a bar (day and visits so far, or when it finished and how long), conversion before → now (or units expected → sold without visit data), the verdict, and what's next while it still applies ("Undo the change" while a fix is in place, "Start markdown" when none started since, or "+€300 extra sales"); measuring plans show conversion so far against as many days before; "How the verdict is made", matching the app's rules
- The product page's "Rescue plan · Not started" card leads here ("How it's measured")
- `/api/results` lists every measuring rescue plan and the newest 100 finished ones of the last 150 days, with their changes, visits and purchases so far and what can still be done, and counts measuring and the last 90 days' verdicts in full; helpers are pure and tested (`src/lib/results.js`)
- Checked in a browser at 1280 px and 390 px, and the API against a local database

## 2026-11-04 · design-markdown-compare
- Markdown redone to the owner's design (`/products/[id]/markdown`): "Markdown · product" with its state ("Running · step 2 of 3", Paused, Ready to start, Ended) and status, "Cancel and restore prices"; "The ladder" as bars (start and each step, done, live and next) with the floor as a dashed red line and when each step goes live, plus each variant's prices when there are several; "Approve schedule" before a plan; what it did ("Sold since the start" against the 30 days before, "Stock left", "Revenue from the plan"); "Rules for this product" and "Never below the floor"; the price log with each change's status
- Compare redone to the design: "Compare" with the 30/60/90 days switch; products as columns (status pill, Remove, "+ Add product"); rows for units, revenue, views, conversion, price vs market, margin, stock (with the variants out of stock), stock value, days since last sale and page quality (photos and words, with what's missing); the best value in each row highlighted
- The markdown API adds what the plan did, the product's status, unit costs and the store's rules; the compare API adds each product's market gap, its variants out of stock, photos and words
- Checked in a browser at 1280 px and 390 px, and the markdown numbers against a local database

## 2026-11-04 · design-collections
- Collection Optimizer redone to the owner's design: "Collection Optimizer" with "The app proposes a better order for each collection. You confirm, then it writes the order to Shopify."
- Left: the collections with their product count and state ("Applied Oct 22 · 3 moved", "Undone Oct 12", "Last save failed", "Not optimized yet", too many products), and automatically sorted ones greyed out with "switch to Manually in Shopify to optimize"
- Right: "Dresses · proposed order" with each product's status, place now and new, and its move (↑ in green, ↓ in amber), its reason and 30-day sales; rows can be dragged (or moved with ↑ ↓); "Back to the proposal", "Skip" (next collection) and "Confirm and apply"
- Below it: the latest applied order with "Undo order" (moved products are measured on their own pages), and the earlier saves
- The collections API adds each collection's latest saved order and the first automatically sorted collections; helpers are pure and tested (`src/lib/collections-page.js`)
- Checked in a browser at 1280 px and 390 px, including dragging a row and applying

## 2026-11-04 · design-inbox
- Inbox redone to the owner's design, with the weekly plan in it: "Inbox · Your weekly plan and everything the app did or found." and "Mark all as read"; the plan card ("Weekly plan · Monday, Nov 2", "N moves for this week", ranked by money at stake, the week picker) with one row per move (what to do, why, and its button) and "Last week" (improved fixes and their extra sales, the other results, markdowns started and ended); then the notifications with the design's icon tiles and colors (a rescue result's color follows its verdict), what kind each is, and when ("2 h ago", "Yesterday", "Oct 20"); unread ones tinted
- The separate "This week" page is gone: `/plan` opens the inbox (old links in notifications still work) and the weekly plan notification, the dashboard and the menu lead to the inbox
- Helpers are pure and tested (`src/lib/inbox.js`)
- Checked in a browser at 1280 px and 390 px

## 2026-11-04 · design-fix-center
- Fix center redone to the owner's design (`/products/[id]/fix`): "Fix center · title", "Changes go straight to Shopify. Every change can be undone." and the AI use this month ("18 of 30 drafts · 9 of 20 photos")
- Description: the text shown as shoppers see it (simple tags only, built safely, with [fill in: …] highlighted), "Write with AI" / "Write again", "Current · N words" and "AI draft · N words" to switch between your text and the draft (edits to both kept), "Edit text" for the HTML
- Photos: the current photos in order (move earlier or later, AI-made ones marked), "Create more with AI" (start photo, white background or a scene), the AI suggestions with a box to pick the ones to add; a product without a photo asks for an upload first
- Title and SEO with what they were and character counts; collections as chips (✕ to remove, "+ name" to add, automated ones in grey)
- Beside them: "From the diagnosis" as a checklist that ticks as the drafts meet each reason (3 photos, 80 words, size/material/care, SEO, a collection), with its hint; the history with Undo
- One bar at the bottom: "N changes ready", Discard, and "Apply to Shopify", which applies each change in turn (then the picked AI photos) and says which went through if one fails; nothing applies while a [fill in: …] is left or a field is too long
- Helpers are pure and tested (`src/lib/fix-page.js`); the fix-center API also gives the diagnosis's reasons with their numbers
- Checked in a browser at 1280 px and 390 px, and the whole flow (AI draft, switching, fill-in, checklist, apply with a failure) with stubbed answers

## 2026-11-04 · design-product
- Product page redone to the owner's design: "← Products"; header with the thumbnail, title, status pill, "N% above market" (past the store's threshold), "Rising star" and markdown pills, "Compare" and "Fix the page"; the soft indigo "Next step" (from the diagnosis's reasons, e.g. "Check the price, add photos and write a fuller description", with "Start in Fix center →"; a running markdown, rescue plan or season comes first); the season in a teal panel; the six numbers (money at stake, stock, sell-through, days of stock, conversion against the store average, last sale); "Daily sales · N sold in 30 days" bars with 30/60/90 days and the window's revenue, visits and conversion; "Why it isn't selling" with a severity chip and a button per reason (to its Fix center section or the right part of the page); "Market price" (Google's benchmark, competitor links with their median, add and remove); "Variants" with stock ("0 · out" in red), sold in 60 days, price and cost; cards for the rescue plan, the markdown (state, ladder and the lowest price it may reach), the rising star actions and returns
- The Fix center and the markdown move to their own pages, as in the design: `/products/[id]/fix` ("Fix center · title", sections reachable by #description, #photos, #seo, #collections) and `/products/[id]/markdown`; their own redesign follows in later tasks
- The product API adds sales per variant over the last 60 days, variant cost, the market gap, the store's conversion over 30 days, the store's day and a markdown summary (running step, why one could start, the margin floor); `marketGaps` can be limited to one product
- Old links to the product page's sections (#page, #overview, #metrics) still land on the right part; markdown news in the inbox and the weekly plan's "Start the markdown" now lead to the markdown page; the next step, the six numbers and the markdown card are pure and tested (`src/lib/product-page.js`)
- Checked in a browser with design-like data at 1280 px and 390 px

## 2026-11-04 · design-products
- Products list redone to the owner's design: "Products" with "Compare products"; one card with a search field, the sort (money at stake, stock value, days of stock, price vs market) and the status filter pills with counts (one filter at a time: a status, "Rising stars", or all); the table with a thumbnail, the status pill plus "Rising star" or "Markdown · step N", money at stake, stock value, days of stock ("over a year" with stock and no sales), sell-through, vs market (above in amber) and the last change; the footnote about the market and products not analyzed yet
- The products API adds each product's last change (the latest applied fix, judged by its rescue plan: "Title changed · Improved", or its day: "Photo added · Oct 12"; pure, tested) and a running markdown's step
- Checked in a browser with design-like data at 1280 px and 390 px

## 2026-11-04 · design-dashboard
- Dashboard redone to the owner's design: "Catalog health" with when it was analyzed and how many products, "All products" and "This week's plan"; "This week · N moves worth €X" (the first three of the week's plan); "Money stuck in stock" with the three key numbers, the status bar and a tile per status (the design's dot colors) plus the dashed "Seasonal · off season" tile; "Next best move" (status, money at stake, days since the last sale, photos, the right button for its status) with "Up next"; "Rising stars" (growth, conversion, "Move to top"); "Running out" (fewest days of stock); "Top 10 to act on today"
- The dashboard API adds what these need: the week's first moves, the next move's facts, the rising stars' conversion over 30 days and the products running out
- Upgrade notes keep their place in the design's soft panel style; the inbox banner is gone (the weekly plan and the menu lead there); "This week" shows only the current week's plan
- Checked in a browser with design-like data at 1280 px and 390 px (the table scrolls in its box on a phone)

## 2026-11-04 · design-shell
- Start of the redesign to the owner's design (Unstuck App Design canvas): the app's own left menu as in the design ("Unstuck" mark, the current page white and bold; a scrolling row at phone width), only pages that are built (Dashboard, Products, Inbox, Collections, Compare, Reports, Plans, Settings; the weekly plan counts as Inbox); Shopify's sub-menu (`ui-nav-menu`) removed, as the owner chose
- Design tokens in Tailwind (`globals.css`): Inter, the light grey ground, ink and muted text, border and line colors, indigo links and the soft indigo panels; shared pieces in `src/app/ui/kit.jsx` (page header with back link and actions, card, buttons, the design's status pills and table classes)
- Pages keep working inside the new frame; each is redone to the design in its own task (docs/TASKS.md, Phase 3a), and the Polaris components go at the end
- The menu rule is pure and tested (`src/lib/nav.js`)
- The Inbox links to the weekly plan until the two are one page (design-inbox); at phone width the current page scrolls into view in the menu row
- Checked in a browser at 1280 px and 390 px

## 2026-11-04 · rising-effect
- Each suggested action on a rising star has a "Done" button: from that day (the store's calendar) its sales are measured as units a day since, against the 30 days before, for 30 days (a result from day 7); only for products that are rising stars; the same action isn't recorded twice while it's measured, also with clicks at the same moment (the database keeps one per product, action and day)
- A rising star moved up 3+ places into the first 24 on the Collections page is recorded the same way, automatically, and removed when that order is undone; a rising star never gets a rescue plan from a move, whatever its status (a "no change" there must not lead to a markdown)
- Product page: "Rising star actions" lists each one with its result ("3 a day since vs 2 before (+50%)"), also after the product stops rising; on every plan
- New table `rising_actions` (RLS on, migrations applied to Supabase); the measurement is pure and tested (`actionEffect`)
- Verified on a local Postgres: an action recorded (also on the Free plan), recorded again (refused), a bad kind, another shop's product, the result 10 days later (+36%), a rising star moved up on the Collections page (recorded once, a non-rising one not, no position fix for healthy products; undone with the order), a rising hidden gem (no rescue plan), three clicks at once (one recorded), bad input and a product that isn't rising

## 2026-11-04 · rising-stars
- New rule with the nightly scores (pure, tested): a rising star sold at least 5 units in the last 30 days, 20% or more above the 30 days before (which had sales), and converts at least as well as the store's median when its visits are known; never dead stock, a slow mover or a product waiting for its season (a stock-out risk can be one: then it needs stock); stored on the score (`product_scores.rising`, migration applied to Supabase)
- Dashboard: a "Rising stars" card with the fastest-growing five (+X%) and "See all"; product list: a "↑ Rising stars" filter and an "↑ Rising" mark on each one
- Product page: "Rising star: sales +X% over the 30 days before" with suggested actions (pure, tested): reorder first when it would run out within 45 days at this pace (not for products sold without stock), move it up in its collections (Collections page), feature it on the home page (theme editor)
- Verified on a local Postgres through the nightly scoring: two rising products (+87%, +38%), a steady one and a small slow mover not; the dashboard, the list and the product page

## 2026-11-03 · weekly-recap
- The Monday plan now carries last week (Monday to Sunday, the store's calendar) too: rescue verdicts whose window ended last week (improved first, with the units sold above what was expected and their value at the product's price), plus any from the 3 weeks before that no plan reported yet (decided late), each reported once; markdowns that went live or ended last week (failed ones aren't listed); the inbox line adds "Last week: N results (€X extra sales), N markdown updates"; a week with results but nothing to do still sends a plan ("Nothing urgent this week")
- "This week" page: a "Last week" section with each verdict (badge, product, extra sales, or the next step for worse / no change) and the markdowns, each linking to the product
- The recap rules are pure and tested (`lastWeekOf`, `verdictLine`, `recapOf`, `verdictCounts`); extra sales are an estimate (extra units × current price)
- Verified on a local Postgres: an improved verdict (+4 units, €100), a worse one on the Sunday, another shop's left out, a verdict decided late (reported once, not repeated), markdowns started and ended, markdowns ending around midnight in Los Angeles and Tokyo (the store's day decides), a failed markdown left out, a Monday with only results

## 2026-11-03 · weekly-plan
- Every Monday morning (07:00 store time, nightly job `weekly-plan`, once per week) the inbox gets "Your plan for this week": up to 5 actions picked from the products that need attention, most money at stake first, with up to 2 places kept for stock-out risks (fewest days left first)
- The action per product (pure, tested): reorder (stock-out risk, days of stock left), start the markdown (when one is due, same rule as the product page), give a hidden gem a better place (Collections), what holds it back (the latest diagnosis's top reason, linking to its section of the product page), or run a diagnosis (never again once one found nothing); products being measured by a rescue plan or already on a markdown are left out before picking, so they don't take places; a week with nothing to do sends nothing
- The product page scrolls to the section a link names once it has loaded (the diagnosis now has its own anchor)
- New "This week" page (nav, and the inbox item opens it): the week's actions with status, money at stake, what to do and a button to where it's done; earlier weeks can be picked; the plan is kept as it was on Monday
- Diagnosis reason names moved to a shared module (`diagnosis-titles.js`)
- Verified on a local Postgres: Tuesday (nothing), Monday (one plan, twice run), the actions and their order (a measured and a marked-down product left out, two stock-outs kept, another shop's product not used), the inbox text, Monday in the store's timezone while it's still Sunday in UTC, the API, a shop with nothing to do

## 2026-11-03 · collection-effect
- A saved collection order measures its effect: each hidden gem, slow mover or dead-stock product it moved up by 3 places or more into the first 24 (what shoppers see first) gets a "Collection position" fix and a rescue plan comparing its sales after the move with before (joining a plan already running for the product)
- Not measured: bestsellers and other healthy products (their sales don't need rescuing, and a "no change" verdict must not lead to a markdown), products that only slid up because others moved down, products the app doesn't know yet; a partly saved order is measured for what moved, an interrupted one isn't
- Each product's bookkeeping on its own: one failing never stops the others or changes the save's or undo's outcome
- Undoing the order on the Collections page undoes those moves too and takes them out of their rescue plans (a plan left with no fixes is cancelled); a collection position can't be undone alone from the fix center (it links to the Collections page instead)
- Product page: the rescue plan says "Moved up in "Summer": from place 5 to 1" with a link to the order (to undo it when the verdict is worse, and the next step says so); the fix center history and the monthly report label it "Collection position"
- The rule for which products are measured is pure and tested (`movedUp`, `movesToMeasure`)
- Verified on a local Postgres with Shopify stubbed: a save moving known and not-synced products (a slow mover and a hidden gem measured, one joining a running plan; a healthy product moved up not measured), the product page and fix center, undoing a position alone (refused), undoing the order (moves undone, a plan cancelled, the other kept), a partly saved order, a save moving nothing into the first places

## 2026-11-03 · collection-reorder
- Collections page: the proposed order can be changed by hand (↑ ↓, "placed by you", back to the proposal), then saved to Shopify only after the merchant confirms ("Save this order to Shopify? … You can undo it.")
- Saving reads the collection again first: if its order changed in Shopify since the page was opened, nothing is written (reload); the order must list each product once (pure, tested)
- Written with `collectionReorderProducts`, only the products not already in place (swapping two of 1,000 is one move; pure, tested), 250 moves per request, each after Shopify's job for the previous one is done; a job not confirmed in time on the last request is saved as "still finishing", on an earlier one the save stops and is kept as partly saved (undoable, also when Shopify applies those moves later)
- Each save is kept with the order before it (new table `collection_reorders`, RLS on, migrations applied to Supabase) and listed under "Saved orders" with Undo; Undo asks first when the order changed since ("Undo anyway") and keeps products added since (after the restored ones)
- One save or undo per collection at a time, enforced by the database (partial unique index); one that crashed is closed after 5 minutes and stays undoable; Undo waits a minute after a save Shopify was still finishing
- On a plan without the optimizer, collections with saved orders are still listed and their saves can be undone
- Verified on a local Postgres with Shopify stubbed (moves applied like Shopify's): save, a stale page, bad orders, history, undo and undo again, changed since then undo anyway with a product added, Shopify refusing, 600 products in 3 requests and back, a slow job on the last and on the first request (also with Shopify applying the moves later), two saves at once, two undos at once and a save during an undo of an old save, a crashed save, another shop's save, the Free plan (saved orders listed and undoable)

## 2026-11-03 · collection-order
- New "Collections" page (nav): lists the collections sorted "Manually" in Shopify (others are counted, with how to switch one to manual; collections over 1,000 products are marked too large) and shows the order the app proposes for the one picked, with each product's new and current place, status, sales in the last 30 days and the reason
- The ordering rule (pure, tested): bestsellers first (the top third by 30-day revenue of the products that can be bestsellers: analyzed, on sale, in stock, selling, and not dead stock, slow movers, page problems or out of season; ones about to run out right after, so they don't sell out sooner), then hidden gems, then products that need sales (slow movers, dead stock; most money waiting first), then the rest in their current order, then page problems ("fix its page first"), out-of-season, sold-out and not-on-sale products
- Products the app doesn't know yet or doesn't analyze on the plan (over the limit, excluded) stay with the rest, in their current order; on the plan as the fix center (Starter and up)
- Nothing is written to Shopify yet (next task: save with Undo)
- Verified on a local Postgres with Shopify stubbed: a 12-product collection over two pages (every group, a product not synced yet, sales older than 30 days not counted, another shop's product with the same Shopify id not used), an automatic collection, a too large one, a missing one, the Free plan

## 2026-11-03 · ai-photos
- Fix center: "Create photo with AI" (OpenAI image API, `gpt-image-2.5-flare`, plain `fetch`, no SDK) from one of the product's photos: a white background (best as the main photo) or a scene (the merchant's own or a fitting one); highlighted when the diagnosis finds too few photos
- The request asks to keep the product exactly as it is (shape, colors, text, logos) and to add no text, watermarks or other products; source photos are read only from Shopify's CDN (https, at most 2048 px, 20 MB, checked by their bytes as JPEG, PNG or WebP)
- The merchant sees the photo first: "Add to product" uploads it to Shopify (staged upload, then added to the product's photos) as a fix in the history, with Undo; "Discard" drops it; drafts are kept for a day (new table `ai_photo_drafts`, RLS on, migration applied to Supabase)
- Undo removes just that photo, even if the photos were reordered since; a photo Shopify added while its answer was lost counts as added once (never uploaded twice), and an attempt that crashed is found by its alt text and undone
- A product with no photo asks for one: the merchant uploads it in the fix center (also undoable)
- AI photos are marked: their alt text says "AI-made photo" (visible in Shopify), they carry an "AI-made" badge in the fix center, and the file goes to Shopify exactly as OpenAI returns it, so its embedded metadata isn't removed
- Drafts not added are removed after a day (nightly job `ai-photo-drafts`); source photos and uploads are read with a 20 MB limit (an upload must state its size)
- Monthly limit per plan (Growth 50, Pro 200; Starter gets the upgrade note), in `ai_usage.photo_calls`, taken atomically and given back when no photo comes out; the cost estimate goes in `photo_cost_usd`; `OPENAI_API_KEY` in `.env.example`
- Readable errors: declined by the AI, bad key or no credit, busy, a photo that can't be used, timeout (150 s)
- Verified on a local Postgres with Shopify (Admin API, CDN, staged upload) and OpenAI stubbed: the request, the draft, add, add twice, undo after a reorder, scene, discard, declined, bad key, server error, limit, two at once with one left, bad input, a source that isn't an image or isn't on the CDN, a failed upload then retry, a lost answer from Shopify, a crashed attempt, a draft left half-added, another shop's draft, an old draft, pruning, no photo and the merchant's upload (and a GIF, too large, no file), Starter, no key
- Open: real use needs the owner's `OPENAI_API_KEY`; removing a photo uses Shopify's `productDeleteMedia` (deprecated, still in 2026-10; its replacement needs the `write_files` permission)

## 2026-11-03 · ai-descriptions
- Fix center: "Write with AI" for the description and SEO (Claude Opus 5.5 through `@anthropic-ai/sdk`, owner approved); highlighted when the diagnosis finds a short, thin or copied description
- The request carries the title, type, vendor, variant options, tags, current description, what the diagnosis found and up to 4 product photos; the answer comes back in the product's language as structured JSON
- Facts the AI doesn't know come back as `[fill in: …]` (also found when written another way, or only listed by the AI); the merchant edits the draft and Apply stays off until every placeholder is filled, on the server too; "Back to my text" brings back what was there before; applying and Undo use the existing fix flow
- The draft's HTML is cleaned before it reaches the editor (only simple tags, no attributes, no scripts; text between tags is escaped, so pieces of removed tags can't form a new one)
- Monthly limit per plan in `ai_usage` (Starter 30, Growth 150, Pro 500; Free gets the upgrade note): a use is reserved atomically before the request and given back when it fails; tokens and cost are recorded either way
- Refusals, cut-off or unusable answers, a bad key and rate limits give a readable message; `ANTHROPIC_API_KEY` in `.env.example`; without a key the button says it isn't set up yet
- Limits per plan are one tested rule (`aiLimit`, `aiUpgradePlan`); requests time out after 90 s with one retry
- Verified on a local Postgres with Shopify and the Claude API stubbed: draft cleaned, request shape (model, fallbacks, effort, JSON schema, images only), usage and cost recorded, refusal, unusable answer, bad key, limit reached, two requests at once with one left, Free plan, no key
- Open: real use needs the owner's `ANTHROPIC_API_KEY`

## 2026-11-03 · returns-report
- Monthly report: new "Returns" section for the orders placed that month: money refunded for returns, units back out of units sold, the most common reasons store-wide and the five products with the most money refunded (rate, units, refunded; each opens its page); the current month counts up to today
- The stored month snapshot includes it (report payload)
- Verified on a local Postgres: October counts only October's orders, another shop's returns are left out, a reason stored under two names is counted once, November so far, a month with nothing

## 2026-11-03 · returns-diagnosis
- New diagnosis reason "Returned often": at least 5 units came back and the product's return rate (returned ÷ sold, last 90 days or since the order history starts) is twice the store's; three times is high; the evidence names the rates, the counts and the most common reason
- The fix center's hint follows the most common reason (size → size chart and fit notes; color, style or "not as described" → true photos and exact description; damaged → supplier; wrong item → fulfillment; late → delivery times)
- Product page: "Returns" line with the rate, units, the store's average, money refunded and the top reasons (the reason's "See the data" link)
- Rules version `rules-v4`
- Verified on a local Postgres: 18% vs a 4.5% store average → high with "Too Small (7)", 4 units back → none, under 1% → none, an order before the history window not counted, the product page numbers

## 2026-11-03 · returns-sync
- New scope `read_returns` (shopify.app.toml, `.env.example`, PLAN); merchants approve it once after the app update. Until then refunds are still read and reasons are skipped with a note; once approved, reasons are read for the whole 60-day window
- `line_refunds`: units refunded per order line after shipping (cancellations of unshipped items aren't returns) and the money refunded, counted against the order's date; `return_reasons`: why each returned item came back (Shopify's reason, or its older reason list); declined or cancelled returns don't count; both RLS on (migration applied to Supabase)
- Nightly `returns-sync` (and after the first import): only orders with refunds or returns in the window, found with Shopify's order search (bulk exports can't read refund or return lines); requests sized under Shopify's cost limit (3 orders × 3 refunds/returns × 10 lines), orders with more completed by extra requests; throttling waits and retries; refunds and reasons keep their own progress, a run stops after 3 minutes and a follow-up continues; orders whose returns were all declined later are re-checked
- Order webhooks now include refunds and update them right away; an older version of an order never overwrites a newer one
- Verified on a local Postgres with Shopify stubbed (errors shaped like the Shopify client's): two pages, a cancellation left out, an order with 4 refunds and a second page of lines, a throttled request, a night without `read_returns` then the backfill, a declined return cleared, a run out of time, webhooks new/stale
- Open: request costs to confirm on the dev store (sizes are kept well under the limit)

## 2026-11-03 · seasonal-reminders
- Inbox, once per season: 30 days before a season starts ("check stock and product pages"), and when a season ends with stock left (stock value, "an end-of-season markdown clears it"); one product opens its page, several open the seasonal list
- For 30 days after its season ends, a product with stock left can get an end-of-season markdown, only when its next season is more than 60 days away (a markdown runs 6 weeks); never for sold-out, draft or excluded products; the product page says so
- Markdown eligibility is one pure, tested rule (`markdownReason`): end of season, else nothing while waiting for the season, else a rescue with no change, else dead stock
- Verified on a local Postgres: nightly scoring on Sep 10–11, Oct 5–6 and a year later (each note once, only products with stock for the end note), markdown eligibility right after a season, long after one, in season, sold out, draft, excluded, and two seasons close together

## 2026-11-03 · seasonal-status
- New status "Seasonal" (no money at stake, not "needs attention"): a seasonal product waiting for its season (out of it, or in its first 30 days; half the season if shorter) is never dead stock, a slow mover or "new"; other statuses (page problem, stock-out risk, hidden gem, healthy) still apply
- In season, days without a sale count from the season's start; a season shorter than 90 days makes an unsold product dead stock on its last day; in the first 60 days sell-through counts only the season so far
- No markdown while a product waits for its season, whatever its status or rescue result; the product page says when its season starts or when it's judged
- Shown in the product list filters, the dashboard mix (teal) and the product page
- Verified on a local Postgres: nightly scoring on four dates of a Nov–Feb season and a Jun–Aug collection; markdown eligibility for in-season, out-of-season and unseasonal products

## 2026-11-03 · seasonal-tags
- Product tags are synced (initial import, nightly refresh, live webhooks); existing products get them at the next nightly refresh (migration applied to Supabase)
- A product's season: a `season:` tag (`season:nov-feb`, `season:11-2`, `season:dec`, `season:winter` = Dec–Feb, northern hemisphere) or a collection marked seasonal in Settings with its months; the product's own tag wins; seasons that overlap or touch are one season, a whole year is none
- Settings: "Seasonal products" section explains the tag and manages seasonal collections (from/to months)
- Product page: "Season" with the months and "In season since …" or "Starts … (in N days)", in the store's calendar
- Verified on a local Postgres: tags stored and updated through the sync code, seasonal collections saved and validated, the season on the product API for a tag, a collection and none
- Next: the "Seasonal" status (`seasonal-status`) and the reminders (`seasonal-reminders`)

## 2026-11-03 · google-market-price
- Settings: "Google Merchant Center" section: connect (Google's consent screen in a new window), choose the account when there are several, read now, disconnect (access revoked, also below the plan and on uninstall); Starter and up
- OAuth: single-use state for 10 minutes (claimed atomically), `content` scope checked, and after Google the merchant confirms the store being connected, so a consent link sent by someone else can't attach their Google account to another store; refresh token stored encrypted (`google_connections`, RLS on); a failed connect revokes Google's token
- Nightly `google-benchmarks` job: Google's price competitiveness report (Merchant API `reports:search`, field names from Google's discovery documents), matched to the shop's own variants by Shopify's offer IDs (`shopify_<COUNTRY>_<product>_<variant>`) into `google_benchmarks` (RLS on)
- Market price section shows Google's average price (country, read date) next to the competitors' median; the "above the market" diagnosis and the "vs market" column use Google's benchmark when a product has no competitor links, matched to the variant priced like the product; benchmarks are used only while connected and read in the last 3 days
- Verified on a local Postgres with Google stubbed: confirm page, connect with one or two accounts, reused/expired/denied/parallel links, missing scope or refresh token, wrong account, two report pages, other shops' offers ignored, diagnosis and list from Google, stale or revoked data unused, disconnect, Free plan, not set up
- Open: a real test needs the owner's Google Cloud project and OAuth client (see TASKS); check on the dev store that the new window opens from Shopify admin; migration applied to Supabase

## 2026-11-03 · market-price-rule
- New diagnosis reason "Price is above the market": the price vs the median of the product's competitor prices (shop currency only); medium above the merchant's threshold (default 10%), high above 25% (or the threshold, if higher); not for products that sell well; links to the Market price section
- Settings: new "Diagnosis" section with "Above the market price by" (1–100%); shares are stored rounded so a price exactly at the threshold isn't flagged
- Product list: "vs market" column (orange above the threshold) and "Most above market" sort, once a product has a comparable competitor price
- One rounded gap (`gapToMarket`) for the rule, the list and the product page, so they always agree; adding or removing a link re-runs the diagnosis
- Starter and up; rules version `rules-v3` (diagnoses are stored fresh once)
- Verified on a local Postgres: 18% → medium with evidence, Free plan → none, threshold 20% → none, 35% → high, exactly 10% → none, list gaps, settings save and validation

## 2026-11-03 · competitor-prices
- Up to 5 competitor links per product (`competitor_links`, RLS on; migration applied to Supabase); the price is read when a link is added and every night (`competitor-prices` job, 5:00 store time)
- Price from the page's main product in JSON-LD (the shop's currency first when there are several), `product:price`/`og:price` tags or microdata; Shopify stores fall back to `/products/<handle>.js` in the page's currency; amounts like "Rs. 1,299", "€1.299", "1.299,00" and "₹1,29,900" are read correctly
- Safe fetch (`src/lib/public-fetch.js`): https only, every DNS answer and redirect checked, no private, cloud-metadata or reserved IPv6 addresses, one 10 s deadline for the whole read, 2 MB cap
- Nightly: links read in the last 20 h are skipped, a run reads for up to 3 min and queues a follow-up for the rest (so big shops finish and other shops aren't held up); a stopped job stores nothing
- Product page: "Market price" section with the competitors' median (shop currency only), your gap to it, each link's price or a readable error, add/remove; Starter and up (`marketPrice`); adding locks the product so 5 stays the maximum
- Verified on a local Postgres: add, duplicate, bad link, 404 page, other currency, 6th link, 7 adds at once, other shop, plan gate, nightly refresh, budget and abort; private addresses refused at connect time
- Open: a real competitor page wasn't fetched (no internet in the sandbox); test on the dev store

## 2026-10-25 · customer-fixes
- From the customer test: a product list (`/products`, in the menu) with status filters and sorting; the dashboard's status tiles and the inbox open it, so every product is reachable; stock-out risks keep 3 places in the Top 10
- Price rule: a product with a type is compared only with products of the same type (never a mixed collection like a coat among socks); no price reason for products that sell well; prices in the store currency; duplicate-description reasons name the products; "What could still be better" for products that sell well
- When Shopify can't be reached: readable 502 messages everywhere ("Couldn't reach Shopify…"), the fix center still shows its history and undo, the markdown and price log still show (with a note), the plans page shows the saved plan
- Plans page: no promise of features that don't exist ("Bulk fixes", the unenforced diagnosis count), "Everything in X, plus", and downgrading to Free asks for confirmation
- Product page: status, next step and key numbers first; the next step follows a running rescue plan; untracked products (gift cards) show "Not tracked"; days of stock as "over a year" when huge; variant names without "Default Title"
- Phone: two status tiles per row, tables scroll sideways instead of being cut off, the sales chart starts at the latest days and a tap shows the day
- Smaller: products under 30 days old aren't slow movers yet; price log names the variant and the reason; markdown shows when the current step went live; report names fix types and undone fixes; Compare says it needs Growth before picking; import errors in plain words
- Second customer test round: new status "New" for products under 30 days old that would otherwise be slow (no money at stake, "too early to judge"); untracked products (gift cards) have no days of stock anywhere; products not analyzed (excluded, over the limit) still show their stock value; on phones the Top 10 and the list keep money and days of stock visible; the next step says when a markdown is running; "sells well" isn't said after worse or unchanged fixes
- Auth: a token Shopify refuses is an auth error (401), and a refused refresh falls back to a token exchange; the plan webhook answers 500 on a refused token (Shopify retries) instead of setting a paying shop to Free; the fix center keeps its drafts after an outage; unanalyzed products show "—" for stock value when it's unknown
- Merged with the UI redesign: its status tiles open the product list and include "New" (which doesn't count as needing attention), days of stock read "over a year" when huge, plan cards show only limits the app enforces and keep the Free confirmation; restored the imports the earlier merge dropped (`/api/dashboard` and the plans page failed on staging)
- Not changed (design choices, noted): description is edited as HTML; one "Apply" per part of the page

## 2026-10-25 · ui-redesign
- Catalog health redesigned: large "money stuck in stock" card with a one-line takeaway, products analyzed / need attention / money at stake, a stacked bar and a tile per status (empty statuses muted), a "Next best move" card (#1 product, its action, up next #2–#4) and a Top 10 table with rank, money-at-stake bars and an action per row; "Days of stock" only shows when a product has it
- Free-plan stores with products that need attention see one line on what Starter adds (dashboard API now returns `plan`)
- `summarize()` adds `needsAttention` and `moneyAtStakeTotal`; new pure `stuckSplit()` for the dead/slow sentence (shares never round to 0% or 100%); 2 new unit tests (141 pass)
- Inbox: icon per notification type, unread highlight, empty state; Monthly report: headline numbers as cards with the formula under each; Plans: cards with limits, "Everything in X, plus", current plan and the next plan up as recommended
- Custom text uses Polaris' font stack; the unused Geist Google fonts are removed (the build no longer fetches Google Fonts); shared card and status colors in `src/app/status-style.js`
- Polaris web components + Tailwind only, no new dependencies; container queries, no sideways scrolling from 320px up (Top 10 hides columns and shows status and days under the title)
- Open: look at it inside the Shopify admin on the dev store (Polaris components can't load in this environment)

## 2026-10-25 · code-review
- Senior review of the whole codebase; fixes are behaviour-preserving
- API routes: the same try/catch + auth boilerplate in 19 routes replaced by `appRoute()`; every error answer is now JSON `{ error }` (some were plain text); app errors (`FixError`, `MarkdownError`, `PlanError`) share `HttpError`; plan gates throw instead of returning responses that were parsed again
- Duplicated helpers removed: day arithmetic and rounding (redefined in 14 modules) now in `src/lib/dates.js`, error messages in `src/lib/http-error.js`, JSON body reading in `readJson()`
- Missing database indexes added for hot queries (latest diagnosis, markdown plans per product, pending price changes per plan) — migration `20261025090000_query_indexes`
- Shopify Admin API calls retry rate-limited/unavailable answers twice; leftover TypeScript-cast parentheses cleaned up; README explains the code layout
- Build, 140 unit tests, migrations vs schema and an undefined-name scan all pass

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
