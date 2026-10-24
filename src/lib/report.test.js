import assert from "node:assert/strict";
import { test } from "node:test";
import { averageCost, dailyBaseline, markdownPeriod, monthlyReport, monthRange, monthsBetween, previousMonth } from "./report.js";

const day = (date, units, revenue) => ({ date, units, revenue });

test("month helpers", () => {
  assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(monthRange("2026-13"), null);
  assert.equal(monthRange("0000-01"), null);
  assert.equal(monthRange("../dashboard"), null);
  assert.equal(previousMonth("2026-01-05"), "2025-12");
  assert.deepEqual(monthsBetween("2025-11", "2026-02"), ["2026-02", "2026-01", "2025-12", "2025-11"]);
  assert.equal(dailyBaseline([day("2026-09-01", 1, 30), day("2026-09-03", 1, 30)], "2026-09-01", "2026-09-10"), 6);
  assert.equal(dailyBaseline([], "2026-09-02", "2026-09-01"), null);
  assert.equal(averageCost([10, null, 0, 20]), 15);
  assert.equal(averageCost([null]), null);
});

test("markdown period: until the day before it ended; baseline = 30 days before, within known history", () => {
  assert.deepEqual(markdownPeriod({ startedOn: "2026-10-15", endedOn: "2026-10-31", historyFrom: "2026-08-01" }), {
    from: "2026-10-15",
    to: "2026-10-30",
    baseline: ["2026-09-15", "2026-10-14"],
  });
  assert.deepEqual(markdownPeriod({ startedOn: "2026-10-15", endedOn: null, historyFrom: "2026-10-01" }).baseline, ["2026-10-01", "2026-10-14"]);
  assert.equal(markdownPeriod({ startedOn: "2026-10-15", endedOn: null, historyFrom: "2026-10-15" }).baseline, null);
});

test("rescue windows count whole in the month they end; markdown days count per month, floored at 0", () => {
  const daily = new Map([
    ["a", [day("2026-09-25", 2, 100), day("2026-10-01", 2, 100), day("2026-10-02", 3, 150)]],
    ["b", [day("2026-10-03", 1, 10)]],
  ]);
  const periods = [
    // Window Sep 20 – Oct 10: counted whole in October (once the window is over).
    { productId: "a", title: "A", kind: "rescue", from: "2026-09-20", to: "2026-10-10", baseline: ["2026-08-30", "2026-09-19"], baselineDaily: 10 },
    // Below its baseline: floored at 0.
    { productId: "b", title: "B", kind: "markdown", from: "2026-10-01", to: null, baseline: ["2026-09-01", "2026-09-30"], baselineDaily: 10 },
  ];
  const base = { periods, daily, unitCost: new Map([["a", 12], ["b", null]]), fixes: [{ id: "f1", appliedOn: "2026-10-02" }, { id: "f0", appliedOn: "2026-09-29" }] };

  const sept = monthlyReport({ ...base, period: "2026-09", today: "2026-11-02" });
  assert.equal(sept.rows.length, 0);
  assert.equal(sept.revenueRecovered, 0);

  const oct = monthlyReport({ ...base, period: "2026-10", today: "2026-11-02" });
  const a = oct.rows.find((x) => x.productId === "a");
  assert.deepEqual([a.from, a.to, a.days, a.actual, a.expected, a.recovered], ["2026-09-20", "2026-10-10", 21, 350, 210, 140]);
  assert.deepEqual([a.units, a.unitCost, a.stockValueCleared, a.costIsEstimate], [7, 12, 84, false]);
  const b = oct.rows.find((x) => x.productId === "b");
  assert.deepEqual([b.days, b.actual, b.expected, b.recovered], [31, 10, 310, 0]);
  assert.deepEqual([b.unitCost, b.stockValueCleared, b.costIsEstimate], [5, 5, true]);
  assert.equal(oct.revenueRecovered, 140);
  assert.equal(oct.productsRescued, 1);
  assert.deepEqual(oct.fixes.map((f) => f.id), ["f1"]);

  // While the window is still open (today Oct 6), the rescue isn't counted; markdown up to yesterday.
  const soFar = monthlyReport({ ...base, period: "2026-10", today: "2026-10-06" });
  assert.deepEqual(soFar.rows.map((r) => [r.productId, r.days]), [["b", 5]]);
  assert.equal(soFar.complete, false);
});

test("no double counting: markdown days inside a rescue window are skipped, even across months", () => {
  const daily = new Map([["a", [day("2026-09-29", 1, 40), day("2026-10-09", 1, 40)]]]);
  const periods = [
    { productId: "a", title: "A", kind: "rescue", from: "2026-09-25", to: "2026-10-10", baseline: ["2026-09-01", "2026-09-24"], baselineDaily: 0 },
    { productId: "a", title: "A", kind: "markdown", from: "2026-09-28", to: "2026-10-20", baseline: ["2026-08-29", "2026-09-27"], baselineDaily: 0 },
  ];
  const base = { periods, daily, unitCost: new Map(), fixes: [] };
  const sept = monthlyReport({ ...base, period: "2026-09", today: "2026-11-02" });
  assert.deepEqual(sept.rows, []); // Sep 28–30 belong to the rescue window, counted in October
  const oct = monthlyReport({ ...base, period: "2026-10", today: "2026-11-02" });
  assert.deepEqual(oct.rows.map((x) => [x.kind, x.days, x.skippedDays, x.actual]), [["rescue", 16, 0, 80], ["markdown", 10, 10, 0]]);
  assert.equal(oct.revenueRecovered, 80);
});

test("a period without a known baseline recovers nothing", () => {
  const r = monthlyReport({
    period: "2026-10",
    today: "2026-11-01",
    periods: [{ productId: "a", title: "A", kind: "markdown", from: "2026-10-01", to: null, baseline: null, baselineDaily: null }],
    daily: new Map([["a", [day("2026-10-02", 1, 50)]]]),
    unitCost: new Map([["a", 10]]),
    fixes: [],
  });
  assert.deepEqual([r.rows[0].expected, r.rows[0].recovered, r.rows[0].stockValueCleared], [null, 0, 10]);
});
