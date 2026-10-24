import assert from "node:assert/strict";
import { test } from "node:test";
import { dailySeries, lastSaleDate, windowTotals, type DailyRow } from "./product-metrics.ts";

const r = (date: string, units: number, extra: Partial<DailyRow> = {}): DailyRow => ({
  date, units, revenue: units * 10, viewSessions: 0, cartSessions: 0, purchaseSessions: 0, ...extra,
});

test("windows count the N days before today, not today itself", () => {
  const rows = [r("2026-10-24", 100), r("2026-10-23", 2), r("2026-09-24", 3), r("2026-09-23", 4), r("2026-07-26", 5)];
  assert.equal(windowTotals(rows, "2026-10-24", 30).units, 5); // 23 Oct + 24 Sep
  assert.equal(windowTotals(rows, "2026-10-24", 60).units, 9);
  assert.equal(windowTotals(rows, "2026-10-24", 90).units, 14);
  assert.equal(windowTotals(rows, "2026-10-24", 30).revenue, 50);
});

test("rates are sessions over views; no views gives null", () => {
  const rows = [r("2026-10-20", 1, { viewSessions: 200, cartSessions: 20, purchaseSessions: 5 })];
  const w = windowTotals(rows, "2026-10-24", 30);
  assert.equal(w.viewToCart, 0.1);
  assert.equal(w.viewToPurchase, 0.025);
  assert.equal(windowTotals([r("2026-10-20", 1)], "2026-10-24", 30).viewToCart, null);
});

test("daily series fills missing days with zero", () => {
  const s = dailySeries([r("2026-10-22", 3)], "2026-10-24", 3);
  assert.deepEqual(s.map((d) => [d.date, d.units]), [["2026-10-21", 0], ["2026-10-22", 3], ["2026-10-23", 0]]);
});

test("last sale date", () => {
  assert.equal(lastSaleDate([r("2026-10-01", 1), r("2026-10-05", 0), r("2026-09-01", 2)]), "2026-10-01");
  assert.equal(lastSaleDate([r("2026-10-01", 0)]), null);
});
