import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateWindow, type Day, type StoreDay } from "./rescue.ts";

const DAY = 86_400_000;
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const START = "2026-09-01";

/** Daily rows from `from` for `days` days with the same numbers each day. */
function days(from: string, n: number, units: number, views: number, purchases: number): Day[] {
  return Array.from({ length: n }, (_, i) => ({ date: shift(from, i), units, views, purchases }));
}
/** Store totals = product + the rest of the store (`restViews`/`restUnits` per day). */
function store(product: Day[], restViews: (date: string) => number, restUnits: (date: string) => number = () => 0): StoreDay[] {
  return product.map((d) => ({ date: d.date, views: d.views + restViews(d.date), units: d.units + restUnits(d.date) }));
}
const flat = () => 1000;

const evaluate = (product: Day[], st: StoreDay[], today: string, extended = false, historyFrom = "2026-01-01") =>
  evaluateWindow({ start: START, today, product, store: st, extended, historyFrom });

test("never ends before 14 days, even with lots of views", () => {
  const p = [...days(shift(START, -30), 30, 1, 20, 1), ...days(START, 13, 3, 50, 3)];
  const r = evaluate(p, store(p, flat), shift(START, 13));
  assert.equal(r.status, "measuring");
});

test("ends at 150 views (after 14 days) and finds an improvement", () => {
  // Before: 20 views/day, 2.5% conversion. After: 11 views/day, ~9% conversion → ≥150 views on day 14.
  const before = days(shift(START, -14), 14, 1, 20, 0.5);
  const after = days(START, 20, 1, 11, 1);
  const p = [...before, ...after];
  const r = evaluate(p, store(p, flat), shift(START, 14));
  assert.equal(r.status, "done");
  if (r.status !== "done") return;
  assert.equal(r.window.from, START);
  assert.equal(r.window.to, shift(START, 13));
  assert.equal(r.baselineWindow.from, shift(START, -14));
  assert.equal(r.after.views, 154);
  assert.equal(r.verdict, "no_change"); // conversion up a lot, but units equal (14 vs 14) → not "improved"
});

test("improved needs conversion +20% and more units than expected", () => {
  const before = days(shift(START, -14), 14, 1, 20, 1); // 5% conversion, 14 units
  const after = days(START, 14, 2, 20, 2); // 10% conversion, 28 units
  const p = [...before, ...after];
  const r = evaluate(p, store(p, flat), shift(START, 14));
  assert.ok(r.status === "done" && r.verdict === "improved");
});

test("worse when conversion falls 20% or more", () => {
  const p = [...days(shift(START, -14), 14, 2, 20, 2), ...days(START, 14, 1, 20, 1.5)];
  const r = evaluate(p, store(p, flat), shift(START, 14));
  assert.ok(r.status === "done" && r.verdict === "worse");
});

test("store-wide traffic change scales the expected units", () => {
  // The rest of the store doubles its traffic after the fix: units doubling is then "no change" in units.
  const before = days(shift(START, -14), 14, 1, 20, 1);
  const after = days(START, 14, 2, 26, 2);
  const p = [...before, ...after];
  const r = evaluate(p, store(p, (d) => (d < START ? 1000 : 2000)), shift(START, 14));
  assert.equal(r.status, "done");
  if (r.status !== "done") return;
  assert.equal(r.trafficRatio, 2);
  assert.equal(r.expectedUnits, 28);
  assert.equal(r.unitsChange, 0);
  assert.equal(r.verdict, "no_change");
});

test("under 50 views: extend once, then 'not enough data'", () => {
  const p = [...days(shift(START, -30), 30, 0, 1, 0), ...days(START, 70, 0, 0.5, 0)]; // 15 views by day 30, 30 by day 60
  const st = store(p, flat);
  assert.equal(evaluate(p, st, shift(START, 30)).status, "extend");
  assert.equal(evaluate(p, st, shift(START, 30), true).status, "measuring");
  const final = evaluate(p, st, shift(START, 60), true);
  assert.ok(final.status === "done" && final.verdict === "not_enough_data");
});

test("without view data: 30-day window, units vs store-scaled baseline", () => {
  const before = days(shift(START, -30), 30, 1, 0, 0);
  const after = days(START, 30, 2, 0, 0);
  const p = [...before, ...after];
  const st = store(p, () => 0, () => 10);
  assert.equal(evaluate(p, st, shift(START, 20)).status, "measuring");
  const r = evaluate(p, st, shift(START, 30));
  assert.ok(r.status === "done" && r.basis === "units" && r.verdict === "improved");
});

test("a baseline cut short by the start of history is scaled to the window; too short says not enough data", () => {
  const before = days(shift(START, -10), 10, 2, 0, 0); // only 10 known days before the fix
  const after = days(START, 30, 2, 0, 0);
  const p = [...before, ...after];
  const st = store(p, () => 0, () => 10);
  const r = evaluate(p, st, shift(START, 30), false, shift(START, -10));
  assert.ok(r.status === "done");
  if (r.status !== "done") return;
  assert.equal(r.baseline.units, 60); // 20 units over 10 days, scaled to 30
  assert.equal(r.verdict, "no_change");
  const short = evaluate(p, st, shift(START, 30), false, shift(START, -5));
  assert.ok(short.status === "done" && short.verdict === "not_enough_data");
});
