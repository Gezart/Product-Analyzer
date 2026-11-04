import assert from "node:assert/strict";
import { test } from "node:test";
import { lastSaleLabel, markdownCard, nextFromReasons, nextStep, productNumbers, reasonAction, salesBars, SECTION_ALIASES } from "./product-page.js";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

test("each diagnosis reason leads to its Fix center section or a part of the page", () => {
  assert.deepEqual(reasonAction("few_images", "p1"), { cta: "Create photos with AI", href: "/products/p1/fix#photos" });
  assert.deepEqual(reasonAction("short_description", "p1"), { cta: "Write with AI", href: "/products/p1/fix#description" });
  assert.deepEqual(reasonAction("missing_seo", "p1"), { cta: "Fix SEO", href: "/products/p1/fix#seo" });
  assert.deepEqual(reasonAction("low_traffic_collections", "p1"), { cta: "Add to a collection", href: "/products/p1/fix#collections" });
  assert.deepEqual(reasonAction("price_above_market", "p1"), { cta: "Review price", href: "#market" });
  assert.deepEqual(reasonAction("price_above_peers", "p1"), { cta: "Compare", href: "/compare?ids=p1" });
  assert.deepEqual(reasonAction("broken_size_run", "p1"), { cta: "See variants", href: "#variants" });
  assert.deepEqual(reasonAction("returned_often", "p1"), { cta: "See returns", href: "#returns" });
  assert.deepEqual(reasonAction("something_new", "p1"), { cta: "See the data", href: "#sales" });
});

test("the next step names up to three things to do, and starts in the Fix center when it can", () => {
  const reasons = [{ code: "price_above_market" }, { code: "few_images" }, { code: "short_description" }, { code: "missing_details" }, { code: "missing_seo" }];
  assert.deepEqual(nextFromReasons(reasons, "p1"), {
    text: "Check the price, add photos and write a fuller description. A rescue plan then measures the result for 14–30 days.",
    cta: { label: "Start in Fix center", href: "/products/p1/fix" },
  });
  // Nothing fixed in the Fix center: the first reason's own place, and no rescue plan sentence.
  assert.deepEqual(nextFromReasons([{ code: "broken_size_run" }], "p1"), { text: "Restock the missing variants.", cta: { label: "See variants", href: "#variants" } });
  assert.equal(nextFromReasons([], "p1"), null);
  assert.equal(nextFromReasons([{ code: "unknown" }], "p1"), null);
  // An unknown reason first: the button goes to the first reason with a place of its own.
  assert.deepEqual(nextFromReasons([{ code: "unknown" }, { code: "returned_often" }], "p1").cta, { label: "See returns", href: "#returns" });
  // Old section links land on today's sections.
  assert.deepEqual(SECTION_ALIASES, { page: "diagnosis", overview: "diagnosis", metrics: "sales" });
});

test("the last sale in days from the store's today", () => {
  assert.deepEqual(lastSaleLabel("2026-11-01", "2026-11-04"), { value: "3 days", sub: "ago" });
  assert.deepEqual(lastSaleLabel("2026-11-04", "2026-11-04"), { value: "Today", sub: "" });
  assert.deepEqual(lastSaleLabel("2026-11-03", "2026-11-04"), { value: "Yesterday", sub: "" });
  assert.equal(lastSaleLabel(null, "2026-11-04"), null);
});

test("daily sales bars: the last N days, scaled to the busiest", () => {
  const daily = Array.from({ length: 90 }, (_, i) => ({ date: `d${i}`, units: i === 89 ? 4 : i === 80 ? 2 : i === 10 ? 8 : 0, known: true }));
  const { bars, total, peak } = salesBars(daily, 30);
  assert.equal(bars.length, 30);
  assert.equal(total, 6);
  assert.equal(peak, 4);
  assert.equal(bars.at(-1).height, 1);
  assert.equal(bars[20].height, 0.5);
  assert.equal(salesBars(daily, 90).total, 14);
  assert.equal(salesBars([], 30).bars.length, 0);
  assert.equal(salesBars(daily.map((d) => ({ ...d, units: 0 })), 30).bars[0].height, 0);
});

test("the markdown card: running, ready, or not needed, with its floor", () => {
  const md = { running: null, reason: null, steps: [0.1, 0.2, 0.3], stepDays: 14, marginFloorPct: 20 };
  const variants = [{ cost: 30 }, { cost: 28 }, { cost: null }];
  assert.deepEqual(markdownCard({ ...md, reason: "Dead stock: no sale for a long time." }, variants, money), {
    state: "Ready",
    body: "Dead stock: no sale for a long time. 10% → 20% → 30% every 14 days. Never below €33.60 (cost €28.00 + 20% margin).",
    cta: "Start markdown",
  });
  assert.equal(markdownCard(md, variants, money).state, "Not needed now");
  assert.match(markdownCard(md, [{ cost: null }], money).body, /add unit costs in Shopify/);
  assert.deepEqual(markdownCard({ ...md, running: { status: "active", step: 2, floor: 33.6 } }, variants, money), {
    state: "Step 2 of 3",
    body: "10% → 20% → 30% every 14 days. Never below €33.60.",
    cta: "See the markdown",
  });
  assert.equal(markdownCard({ ...md, running: { status: "active", step: null, floor: 33.6 } }, variants, money).state, "Starting");
  assert.equal(markdownCard({ ...md, running: { status: "paused", step: 1, floor: 33.6 } }, variants, money).state, "Paused");
});

const product = (over = {}) => ({
  product: { id: "p1", season: null, status: "ACTIVE" },
  score: { status: "slow_mover", moneyAtStake: 1260, stockValue: 1800, sellThrough: 0.14 },
  rescuePlan: null,
  markdown: { running: null, reason: null, reasonKind: null, steps: [0.1, 0.2, 0.3], stepDays: 14, marginFloorPct: 10 },
  stock: 64,
  stockValue: 1800,
  stockValueIsEstimate: false,
  untracked: false,
  daysOfCover: 320,
  lastSale: "2026-11-01",
  today: "2026-11-04",
  storeConversion: 0.014,
  windows: [{ days: 30, views: 1000, viewToPurchase: 0.006 }],
  ...over,
});

test("the next step: markdown and rescue plan first, then a due markdown, the season, the diagnosis, the status", () => {
  const md = product().markdown;
  assert.deepEqual(nextStep(product({ markdown: { ...md, running: { status: "active", step: 2, floor: 30 } } }), []), {
    text: "A markdown is running: its price steps down every 14 days until the stock sells.",
    cta: { label: "Open the markdown", href: "/products/p1/markdown" },
  });
  assert.equal(nextStep(product({ markdown: { ...md, running: { status: "paused", step: 2, floor: 30 } } }), []).cta.label, "See why");
  const measuring = { fixIds: ["f1"], verdict: null, moves: [] };
  assert.equal(nextStep(product({ rescuePlan: measuring }), []).cta.href, "#rescue");
  assert.equal(nextStep(product({ rescuePlan: { ...measuring, verdict: "worse" } }), []).text, "Sales fell after the fixes: undo them.");
  assert.equal(nextStep(product({ rescuePlan: { ...measuring, verdict: "worse", moves: [{ fixId: "f1" }] } }), []).text, "Sales fell after the new collection order: undo it.");
  // A due markdown (dead stock, a rescue plan with no change, a season just ended) comes before the page fixes.
  const due = nextStep(product({ score: { status: "dead_stock" }, markdown: { ...md, reason: "Dead stock: no sale for a long time.", reasonKind: "dead_stock" } }), [{ code: "few_images" }]);
  assert.deepEqual(due, { text: "Dead stock: no sale for a long time. Clear the stock with a stepped markdown.", cta: { label: "Start markdown", href: "/products/p1/markdown" } });
  assert.equal(nextStep(product({ markdown: { ...md, reason: "Its season ended today: …", reasonKind: "end_of_season" } }), []).text, "Its season ended today: …");
  const season = { label: "May–Aug", inSeason: false, daysToStart: 1 };
  assert.deepEqual(nextStep(product({ score: { status: "seasonal" }, product: { id: "p1", season } }), []), { text: "Nothing until its season (May–Aug) starts in 1 day; it isn't dead stock.", cta: null });
  assert.equal(nextStep(product(), [{ code: "few_images" }]).text, "Add photos. A rescue plan then measures the result for 14–30 days.");
  // The diagnosis still running (or finding nothing): the status's advice, in the Fix center.
  assert.deepEqual(nextStep(product(), null), { text: "Diagnose, then rescue plan.", cta: { label: "Start in Fix center", href: "/products/p1/fix" } });
  assert.equal(nextStep(product({ score: { status: "hidden_gem" } }), null).cta.href, "/collections");
  assert.equal(nextStep(product({ score: { status: "stockout_risk" } }), null).cta.href, "#variants");
  assert.equal(nextStep(product({ score: { status: "over_limit" } }), null).cta.href, "/plans");
  assert.deepEqual(nextStep(product({ score: { status: "healthy" } }), null), { text: "Nothing to do.", cta: null });
  assert.equal(nextStep(product({ score: null }), null), null);
});

test("the six numbers, also for products sold without stock, not analyzed, or without sales", () => {
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const values = (d) => productNumbers(d, money).map((k) => [k.value, k.sub]);
  assert.deepEqual(values(product()), [
    ["€1,260", "70% of stock value"],
    ["64", "€1,800 at cost"],
    ["14%", "last 60 days"],
    ["320", "at today's pace"],
    ["0.6%", "store average 1.4%"],
    ["3 days", "ago"],
  ]);
  const untracked = values(product({ untracked: true, daysOfCover: null }));
  assert.deepEqual([untracked[1], untracked[3]], [["—", "sells without stock"], ["—", "sells without stock"]]);
  const quiet = values(product({ score: { status: "excluded" }, daysOfCover: null, lastSale: null, windows: [{ days: 30, views: 0, viewToPurchase: null }] }));
  assert.deepEqual([quiet[0], quiet[3], quiet[4], quiet[5]], [["—", "not analyzed"], ["over a year", "no sales in 30 days"], ["—", "no visit data yet"], ["None", "in known history"]]);
  assert.deepEqual(values(product({ stock: 0, daysOfCover: null, stockValueIsEstimate: true }))[3], ["—", "no stock"]);
  assert.equal(values(product({ stockValueIsEstimate: true }))[1][1], "€1,800 at cost (est.)");
  assert.equal(values(product({ score: null }))[2][0], "—");
});
