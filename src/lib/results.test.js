import assert from "node:assert/strict";
import { test } from "node:test";
import { liveTotals, resultRow } from "./results.js";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const opts = { today: "2026-11-04", money };
const live = (views, purchases = 0, beforeViews = 0, beforePurchases = 0) => ({ days: 0, views, purchases, beforeViews, beforePurchases });
const plan = (over = {}) => ({
  productId: "p1", title: "Slim Jeans", price: 50, startedAt: "2026-10-03", endsAt: null, verdict: null, result: null,
  fixTypes: ["title"], extended: false, live: live(0), undoable: true, markdownable: true, ...over,
});

test("a measuring plan: its day, visits and conversion so far", () => {
  const row = resultRow(plan({ startedAt: "2026-10-17", live: live(132, 2, 200, 2) }), opts);
  assert.equal(row.window, "Day 19 · 132 of 150 visits");
  assert.equal(row.verdict.label, "Measuring");
  assert.equal(row.conversion, "1.0% → 1.5% so far");
  assert.equal(row.next, null);
  assert.ok(row.progress > 0.8 && row.progress < 1);
  // The target reached before day 14: it ends on day 14.
  assert.equal(resultRow(plan({ startedAt: "2026-10-31", live: live(160, 3) }), opts).window, "Day 5 · 150 visits reached, ends on day 14");
  // No visit data: sales are compared over the full window.
  const noViews = resultRow(plan({ startedAt: "2026-10-27", fixTypes: ["photo", "photo", "description"] }), opts);
  assert.equal(noViews.window, "Day 9 of 30 · sales compared");
  assert.equal(noViews.conversion, "—");
  assert.equal(noViews.change, "Photo added, Description changed");
  assert.equal(noViews.started, "Oct 27");
  assert.equal(resultRow(plan({ startedAt: "2026-10-27", extended: true }), opts).window, "Day 9 of 60 · sales compared");
});

test("visits and purchases so far, and as many days before the change", () => {
  const rows = [
    { date: "2026-10-25", views: 40, purchases: 1 },
    { date: "2026-10-31", views: 10, purchases: 0 },
    { date: "2026-11-01", views: 20, purchases: 1 },
    { date: "2026-11-03", views: 30, purchases: 1 },
    { date: "2026-11-04", views: 99, purchases: 9 },
  ];
  // Started Nov 1 (baseline ends there): 3 complete days so far, and the 3 days before.
  assert.deepEqual(liveTotals(rows, { start: "2026-11-01", baselineEnd: "2026-11-01", today: "2026-11-04" }), { days: 3, views: 50, purchases: 2, beforeViews: 10, beforePurchases: 0 });
});

test("a finished plan: its window, conversion before → now, verdict and what's next", () => {
  const improved = resultRow(
    plan({
      verdict: "improved",
      result: { basis: "conversion", baseline: { conversion: 0.019 }, after: { conversion: 0.026, units: 16 }, expectedUnits: 9.8, conversionChange: 0.37, window: { from: "2026-10-03", to: "2026-10-23" } },
    }),
    opts,
  );
  assert.equal(improved.window, "Finished Oct 23 · 21 days");
  assert.equal(improved.conversion, "1.9% → 2.6% · +37%");
  assert.deepEqual(improved.verdict, { label: "Improved", tone: "good" });
  assert.deepEqual(improved.next, { note: "+€300 extra sales" });
  assert.equal(improved.progress, 1);
  const worse = resultRow(plan({ verdict: "worse", result: { basis: "conversion", baseline: { conversion: 0.011 }, after: { conversion: 0.008 }, conversionChange: -0.27 } }), opts);
  assert.equal(worse.conversion, "1.1% → 0.8% · −27%");
  assert.deepEqual(worse.next, { cta: "Undo the change", href: "/products/p1#rescue" });
  assert.equal(resultRow(plan({ verdict: "worse", fixTypes: ["position"] }), opts).next.cta, "Undo the order");
  assert.deepEqual(resultRow(plan({ verdict: "no_change" }), opts).next, { cta: "Start markdown", href: "/products/p1/markdown" });
  // Only while it still applies: the fixes still in place, no markdown started since.
  assert.equal(resultRow(plan({ verdict: "worse", undoable: false }), opts).next, null);
  assert.equal(resultRow(plan({ verdict: "no_change", markdownable: false }), opts).next, null);
  // A cancelled plan: every change undone, no window to show.
  const cancelled = resultRow(plan({ verdict: "cancelled", fixTypes: [], endsAt: "2026-11-24" }), opts);
  assert.deepEqual([cancelled.change, cancelled.window, cancelled.progress], ["All changes undone", "Stopped: every change was undone", 0]);
  // A finished plan without a stored window ends the day before its end.
  assert.equal(resultRow(plan({ verdict: "not_enough_data", endsAt: "2026-11-02" }), opts).window, "Finished Nov 1 · 30 days");
  // Without visit data, units are compared.
  const units = resultRow(plan({ verdict: "no_change", result: { basis: "units", expectedUnits: 12.4, after: { units: 13 }, unitsChange: 0.05 } }), opts);
  assert.equal(units.conversion, "12 expected → 13 sold · +5%");
  assert.equal(resultRow(plan({ verdict: "not_enough_data" }), opts).next, null);
});
