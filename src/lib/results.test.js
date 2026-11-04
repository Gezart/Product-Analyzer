import assert from "node:assert/strict";
import { test } from "node:test";
import { resultRow, resultSummary } from "./results.js";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const opts = { today: "2026-11-04", money, locale: "en-US" };
const plan = (over = {}) => ({ productId: "p1", title: "Slim Jeans", price: 50, startedAt: "2026-10-03", endsAt: null, verdict: null, result: null, fixTypes: ["title"], extended: false, viewsSoFar: 0, ...over });

test("a measuring plan: its day and visits so far", () => {
  const row = resultRow(plan({ startedAt: "2026-10-17", viewsSoFar: 132 }), opts);
  assert.equal(row.window, "Day 19 · 132 of 150 visits");
  assert.equal(row.verdict.label, "Measuring");
  assert.equal(row.conversion, "—");
  assert.equal(row.next, null);
  assert.ok(row.progress > 0.8 && row.progress < 1);
  const noViews = resultRow(plan({ startedAt: "2026-10-27", fixTypes: ["photo", "photo", "description"] }), opts);
  assert.equal(noViews.window, "Day 9 of 14–30");
  assert.equal(noViews.change, "Photo added, Description changed");
  assert.equal(noViews.started, "Oct 27");
  assert.equal(resultRow(plan({ startedAt: "2026-10-27", extended: true }), opts).window, "Day 9 of 14–60");
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
  assert.deepEqual(improved.next, { note: "+€300 recovered" });
  assert.equal(improved.progress, 1);
  const worse = resultRow(plan({ verdict: "worse", result: { basis: "conversion", baseline: { conversion: 0.011 }, after: { conversion: 0.008 }, conversionChange: -0.27 } }), opts);
  assert.equal(worse.conversion, "1.1% → 0.8% · −27%");
  assert.deepEqual(worse.next, { cta: "Undo the change", href: "/products/p1#rescue" });
  assert.equal(resultRow(plan({ verdict: "worse", fixTypes: ["position"] }), opts).next.cta, "Undo the order");
  assert.deepEqual(resultRow(plan({ verdict: "no_change" }), opts).next, { cta: "Start markdown", href: "/products/p1/markdown" });
  // Without visit data, units are compared.
  const units = resultRow(plan({ verdict: "no_change", result: { basis: "units", expectedUnits: 12.4, after: { units: 13 }, unitsChange: 0.05 } }), opts);
  assert.equal(units.conversion, "12 expected → 13 sold · +5%");
  assert.equal(resultRow(plan({ verdict: "not_enough_data" }), opts).next, null);
});

test("the counts: measuring now and the last 90 days' verdicts", () => {
  const ended = (verdict, to) => plan({ verdict, result: { window: { to } } });
  const s = resultSummary(
    [plan(), plan(), ended("improved", "2026-10-23"), ended("improved", "2026-06-01"), ended("no_change", "2026-09-10"), ended("worse", "2026-11-01"), ended("cancelled", "2026-11-01")],
    "2026-11-04",
  );
  assert.deepEqual(s, { measuring: 2, improved: 1, noChange: 1, worse: 1 });
});
