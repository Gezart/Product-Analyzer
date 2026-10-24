import assert from "node:assert/strict";
import { test } from "node:test";
import { knownOrderDays } from "./constants.js";

test("known order history starts at the imported window", () => {
  assert.equal(knownOrderDays({ windowStart: null, today: "2026-10-24", live: true }), 0);
  assert.equal(knownOrderDays({ windowStart: "gid://shopify/BulkOperation/1", today: "2026-10-24", live: true }), 0);
  assert.equal(knownOrderDays({ windowStart: "2026-08-25", today: "2026-10-24", live: true }), 60);
});

test("with live sync it grows; without it stays at the import window", () => {
  assert.equal(knownOrderDays({ windowStart: "2026-08-25", today: "2026-12-23", live: true }), 120);
  assert.equal(knownOrderDays({ windowStart: "2026-08-25", today: "2026-12-23", live: false }), 60);
});
