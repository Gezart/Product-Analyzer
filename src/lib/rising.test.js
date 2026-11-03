import assert from "node:assert/strict";
import { test } from "node:test";
import { growthLabel, risingActions } from "./rising.js";

test("a rising star's actions: stock first when it runs out within 45 days, then visibility", () => {
  assert.deepEqual(risingActions({ daysOfCover: 20.4 }).map((a) => a.kind), ["stock", "collections", "home"]);
  assert.match(risingActions({ daysOfCover: 20.4 })[0].text, /about 20 days/);
  assert.deepEqual(risingActions({ daysOfCover: 90 }).map((a) => a.kind), ["collections", "home"]);
  assert.deepEqual(risingActions({ daysOfCover: null }).map((a) => a.kind), ["collections", "home"]);
  assert.equal(growthLabel(1.354), "+35%");
  assert.equal(growthLabel(null), "");
});
