import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, validateSettings } from "./settings.js";

test("defaults are valid", () => {
  assert.deepEqual(validateSettings(DEFAULT_SETTINGS), { ok: true, value: DEFAULT_SETTINGS });
});

test("valid changes pass and duplicate collections are removed", () => {
  const r = validateSettings({
    ...DEFAULT_SETTINGS,
    thresholds: { ...DEFAULT_SETTINGS.thresholds, deadDays: 60, slowSellThrough: 0.3 },
    marginFloorPct: 15,
    excludedCollectionIds: ["gid://shopify/Collection/1", "gid://shopify/Collection/1"],
  });
  assert.ok(r.ok);
  assert.equal(r.value.thresholds.deadDays, 60);
  assert.deepEqual(r.value.excludedCollectionIds, ["gid://shopify/Collection/1"]);
});

test("out-of-range, wrong-type and missing values are rejected with field errors", () => {
  const r = validateSettings({
    thresholds: { ...DEFAULT_SETTINGS.thresholds, deadDays: 7.5, minViews: "20", pageProblemViewsTop: 1.5 },
    marginFloorPct: -1,
    maxDiscountPct: 95,
    excludedCollectionIds: ["123"],
    excludedProductIds: ["gid://shopify/Collection/1"],
    markdownEndAction: "sometimes",
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.errors.map((e) => e.field), [
    "thresholds.pageProblemViewsTop",
    "thresholds.deadDays",
    "thresholds.minViews",
    "marginFloorPct",
    "maxDiscountPct",
    "excludedCollectionIds",
    "excludedProductIds",
    "markdownEndAction",
  ]);
  assert.deepEqual(r.errors[1], { field: "thresholds.deadDays", min: 14, max: 365, integer: true });
  assert.equal(validateSettings(null).ok, false);
});

test("percentages are rounded to 2 decimals and product IDs are accepted", () => {
  const r = validateSettings({ ...DEFAULT_SETTINGS, marginFloorPct: 12.345, excludedProductIds: ["gid://shopify/Product/9"] });
  assert.ok(r.ok);
  assert.equal(r.value.marginFloorPct, 12.35);
  assert.deepEqual(r.value.excludedProductIds, ["gid://shopify/Product/9"]);
});
