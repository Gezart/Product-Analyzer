import assert from "node:assert/strict";
import { test } from "node:test";
import { actionEffect, growthLabel, risingActions } from "./rising.js";

test("a rising star's actions: stock first when it runs out within 45 days, then visibility", () => {
  assert.deepEqual(risingActions({ daysOfCover: 20.4 }).map((a) => a.kind), ["stock", "collections", "home"]);
  assert.match(risingActions({ daysOfCover: 20.4 })[0].text, /about 20 days/);
  assert.deepEqual(risingActions({ daysOfCover: 90 }).map((a) => a.kind), ["collections", "home"]);
  assert.deepEqual(risingActions({ daysOfCover: null }).map((a) => a.kind), ["collections", "home"]);
  assert.equal(growthLabel(1.354), "+35%");
  assert.equal(growthLabel(null), "");
});

test("rising star actions at the edges: 45 days and up, none, or none left", () => {
  assert.deepEqual(risingActions({ daysOfCover: 45 }).map((a) => a.kind), ["collections", "home"]);
  assert.deepEqual(risingActions({ daysOfCover: 44.9 }).map((a) => a.kind), ["stock", "collections", "home"]);
  assert.match(risingActions({ daysOfCover: 0 })[0].text, /about 0 days/);
  assert.equal(risingActions({ daysOfCover: 0 })[0].href, "#variants");
});

test("an action's effect: units a day since it against the 30 days before", () => {
  // 2 a day for the 30 days before Nov 4, then 3 a day.
  const rows = [];
  for (let i = 1; i <= 30; i++) rows.push({ date: new Date(Date.UTC(2026, 10, 4) - i * 86_400_000).toISOString().slice(0, 10), units: 2 });
  for (let i = 0; i < 40; i++) rows.push({ date: new Date(Date.UTC(2026, 10, 4) + i * 86_400_000).toISOString().slice(0, 10), units: 3 });
  rows.push({ date: "2026-09-01", units: 99 }); // older than the 30 days before: not counted
  // Day 10 (today Nov 14): 10 complete days.
  assert.deepEqual(actionEffect(rows, "2026-11-04", "2026-11-14"), { days: 10, before: 2, after: 3, change: 0.5, done: false });
  // Under 7 days: no result yet.
  assert.equal(actionEffect(rows, "2026-11-04", "2026-11-09").change, null);
  // After 30 days: final, later sales not counted.
  assert.deepEqual(actionEffect(rows, "2026-11-04", "2026-12-20"), { days: 30, before: 2, after: 3, change: 0.5, done: true });
  // No sales before: no change to show.
  assert.equal(actionEffect(rows.filter((r) => r.date >= "2026-11-04"), "2026-11-04", "2026-11-14").change, null);
  // Today is the start: nothing yet.
  assert.deepEqual(actionEffect(rows, "2026-11-04", "2026-11-04"), { days: 0, before: 2, after: 0, change: null, done: false });
});
