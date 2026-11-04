import assert from "node:assert/strict";
import { test } from "node:test";
import { lastSaleLabel, markdownCard, nextFromReasons, reasonAction, salesBars } from "./product-page.js";

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
