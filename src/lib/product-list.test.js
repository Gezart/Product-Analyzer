import assert from "node:assert/strict";
import { test } from "node:test";
import { changeLabel } from "./product-list.js";

test("the last change: what changed, then its verdict or its day", () => {
  assert.equal(changeLabel({ type: "title", at: "2026-10-20T09:00:00Z", verdict: "improved" }), "Title changed · Improved");
  assert.equal(changeLabel({ type: "photo", at: "2026-10-12T09:00:00Z", verdict: null }), "Photo added · Oct 12");
  assert.equal(changeLabel({ type: "seo", at: "2026-10-12T09:00:00Z", verdict: "measuring" }), "SEO changed · Measuring");
  assert.equal(changeLabel({ type: "images", at: "2026-10-01T00:00:00Z", verdict: "cancelled" }), "Photos reordered · Oct 1");
  assert.equal(changeLabel({ type: "other", at: null, verdict: null }), "Changed");
  assert.equal(changeLabel(null), "—");
});
