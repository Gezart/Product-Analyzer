import assert from "node:assert/strict";
import { test } from "node:test";
import { asDate, dateKey, daysBetween, round2, shiftDate } from "./dates.js";

test("date helpers work on calendar days, across month and DST boundaries", () => {
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDate("2026-10-24", 8), "2026-11-01");
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
  assert.equal(daysBetween("2026-10-25", "2026-10-24"), -1);
  assert.equal(dateKey(asDate("2026-10-25")), "2026-10-25");
  assert.equal(round2(10.005), 10.01);
  assert.equal(round2(2 / 3), 0.67);
});
