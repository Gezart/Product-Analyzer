import assert from "node:assert/strict";
import { test } from "node:test";
import { daysPhrase, formatDays } from "./status-info.js";

test("days of stock read as people say them", () => {
  assert.equal(formatDays(null), "—");
  assert.equal(formatDays(12.4), "12");
  assert.equal(formatDays(400), "over a year");
  assert.equal(daysPhrase(null), "—");
  assert.equal(daysPhrase(0.6), "1 day");
  assert.equal(daysPhrase(12.4), "12 days");
  assert.equal(daysPhrase(365), "365 days");
  assert.equal(daysPhrase(366), "over a year");
});
