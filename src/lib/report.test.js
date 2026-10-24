import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyBaseline, monthlyReport, monthRange, previousMonth } from "./report.js";

const day = (date, units, revenue) => ({ date, units, revenue });

test("month helpers", () => {
  assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(monthRange("2026-13"), null);
  assert.equal(monthRange("x"), null);
  assert.equal(previousMonth("2026-01-05"), "2025-12");
  assert.equal(dailyBaseline([day("2026-09-01", 1, 30), day("2026-09-03", 1, 30)], "2026-09-01", "2026-09-10"), 6);
});

test("revenue recovered = actual − baseline daily × days, floored at 0; only days inside the month and before today", () => {
  const daily = new Map([
    ["a", [day("2026-09-30", 5, 500), day("2026-10-01", 2, 100), day("2026-10-02", 3, 150), day("2026-10-05", 1, 50)]],
    ["b", [day("2026-10-03", 1, 10)]],
  ]);
  const r = monthlyReport({
    period: "2026-10",
    today: "2026-10-06",
    periods: [
      // Window from Sep 20 to Oct 10: only Oct 1–5 count (today is Oct 6).
      { productId: "a", title: "A", kind: "rescue", from: "2026-09-20", to: "2026-10-10", baselineDaily: 20 },
      // Below its baseline: floored at 0.
      { productId: "b", title: "B", kind: "markdown", from: "2026-10-01", to: "2026-10-31", baselineDaily: 10 },
    ],
    daily,
    unitCost: new Map([["a", 12], ["b", null]]),
    rescued: [{ productId: "a", windowEnd: "2026-10-10" }, { productId: "z", windowEnd: "2026-09-30" }],
    fixes: [{ id: "f1", appliedOn: "2026-10-02" }, { id: "f0", appliedOn: "2026-09-29" }],
  });
  const a = r.rows.find((x) => x.productId === "a");
  assert.deepEqual([a.from, a.to, a.days, a.actual, a.expected, a.recovered], ["2026-10-01", "2026-10-05", 5, 300, 100, 200]);
  assert.deepEqual([a.units, a.unitCost, a.stockValueCleared, a.costIsEstimate], [6, 12, 72, false]);
  const b = r.rows.find((x) => x.productId === "b");
  assert.deepEqual([b.days, b.actual, b.expected, b.recovered], [5, 10, 50, 0]);
  // No cost: 50% of the sale price (10 per unit → 5).
  assert.deepEqual([b.unitCost, b.stockValueCleared, b.costIsEstimate], [5, 5, true]);
  assert.equal(r.revenueRecovered, 200);
  assert.equal(r.stockValueCleared, 77);
  assert.equal(r.complete, false);
  assert.equal(r.to, "2026-10-05");
  assert.equal(r.productsRescued, 1);
  assert.deepEqual(r.fixes.map((f) => f.id), ["f1"]);
});

test("a day is counted once per product even if a rescue and a markdown period overlap", () => {
  const r = monthlyReport({
    period: "2026-10",
    today: "2026-11-02",
    periods: [
      { productId: "a", title: "A", kind: "rescue", from: "2026-10-01", to: "2026-10-10", baselineDaily: 0 },
      { productId: "a", title: "A", kind: "markdown", from: "2026-10-08", to: "2026-10-20", baselineDaily: 0 },
    ],
    daily: new Map([["a", [day("2026-10-09", 1, 40)]]]),
    unitCost: new Map(),
    rescued: [],
    fixes: [],
  });
  assert.deepEqual(r.rows.map((x) => [x.kind, x.days, x.actual]), [["rescue", 10, 40], ["markdown", 10, 0]]);
  assert.equal(r.revenueRecovered, 40);
  assert.equal(r.complete, true);
});
