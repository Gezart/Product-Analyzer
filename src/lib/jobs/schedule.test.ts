import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffMs, localDateKey, nextLocalRun, retryPlan } from "./schedule.ts";

test("backoff doubles from 30s and caps at 1h", () => {
  assert.deepEqual([1, 2, 3, 4].map(backoffMs), [30_000, 60_000, 120_000, 240_000]);
  assert.equal(backoffMs(20), 3_600_000);
  assert.equal(backoffMs(0), 30_000);
});

test("next 02:00 in UTC", () => {
  assert.equal(nextLocalRun(new Date("2026-10-24T01:00:00Z"), "UTC", 2).toISOString(), "2026-10-24T02:00:00.000Z");
  assert.equal(nextLocalRun(new Date("2026-10-24T02:00:00Z"), "UTC", 2).toISOString(), "2026-10-25T02:00:00.000Z");
});

test("next 02:00 in the store's timezone", () => {
  // Tirana is UTC+2 in summer time (until 25 Oct 2026).
  assert.equal(nextLocalRun(new Date("2026-10-23T12:00:00Z"), "Europe/Tirane", 2).toISOString(), "2026-10-24T00:00:00.000Z");
  // New York is UTC-4 in October.
  assert.equal(nextLocalRun(new Date("2026-10-24T03:00:00Z"), "America/New_York", 2).toISOString(), "2026-10-24T06:00:00.000Z");
});

test("handles the DST change", () => {
  // Europe switches to winter time on 25 Oct 2026: 02:00 local is 01:00Z on the 26th.
  assert.equal(nextLocalRun(new Date("2026-10-25T12:00:00Z"), "Europe/Tirane", 2).toISOString(), "2026-10-26T01:00:00.000Z");
});

test("unknown timezone falls back to UTC", () => {
  assert.equal(nextLocalRun(new Date("2026-10-24T01:00:00Z"), "Mars/Base", 2).toISOString(), "2026-10-24T02:00:00.000Z");
  assert.equal(localDateKey(new Date("2026-10-24T23:30:00Z"), null), "2026-10-24");
});

test("local date key follows the timezone", () => {
  assert.equal(localDateKey(new Date("2026-10-24T23:30:00Z"), "Europe/Tirane"), "2026-10-25");
  assert.equal(localDateKey(new Date("2026-10-24T02:30:00Z"), "America/New_York"), "2026-10-23");
});

test("retry plan: backoff until max attempts, permanent errors fail at once", () => {
  const now = new Date("2026-10-24T00:00:00Z");
  assert.deepEqual(retryPlan(1, 5, false, now), { status: "queued", runAt: new Date("2026-10-24T00:00:30Z") });
  assert.deepEqual(retryPlan(5, 5, false, now), { status: "failed", runAt: null });
  assert.deepEqual(retryPlan(1, 5, true, now), { status: "failed", runAt: null });
});

test("midnight runs survive a DST gap at midnight (Havana, Santiago)", () => {
  // Havana skips 00:00–01:00 on 8 Mar 2026: the run moves to 01:00 local, same date, in the future.
  // 04:43Z is still 7 Mar locally (UTC-5), so the next midnight is the missing one on 8 Mar.
  const a = new Date("2026-03-08T04:43:00Z");
  const runA = nextLocalRun(a, "America/Havana", 0);
  assert.equal(runA.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(localDateKey(runA, "America/Havana"), "2026-03-08");
  const b = new Date("2026-03-07T05:39:00Z");
  const runB = nextLocalRun(b, "America/Havana", 0);
  assert.equal(runB.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(localDateKey(runB, "America/Havana"), "2026-03-08");
  const c = new Date("2026-09-05T05:54:00Z");
  const runC = nextLocalRun(c, "America/Santiago", 0);
  assert.ok(runC > c);
  assert.equal(localDateKey(runC, "America/Santiago"), "2026-09-06");
});

test("New York spring forward and fall back", () => {
  // 8 Mar 2026: 02:00 doesn't exist, run at 03:00 EDT.
  assert.equal(nextLocalRun(new Date("2026-03-08T05:00:00Z"), "America/New_York", 2).toISOString(), "2026-03-08T07:00:00.000Z");
  // 1 Nov 2026: 01:00 happens twice, take the first (EDT).
  assert.equal(nextLocalRun(new Date("2026-11-01T04:00:00Z"), "America/New_York", 1).toISOString(), "2026-11-01T05:00:00.000Z");
  assert.equal(nextLocalRun(new Date("2026-11-01T04:00:00Z"), "America/New_York", 2).toISOString(), "2026-11-01T07:00:00.000Z");
});
