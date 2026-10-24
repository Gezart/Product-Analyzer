import assert from "node:assert/strict";
import { test } from "node:test";
import { bestIndex, grossMargin, pageQuality, parseCompareIds, stockAge } from "./compare.js";

test("ids: 1–4 distinct, trimmed; otherwise null", () => {
  assert.deepEqual(parseCompareIds(" a, b ,a,"), ["a", "b"]);
  assert.equal(parseCompareIds(""), null);
  assert.equal(parseCompareIds(null), null);
  assert.equal(parseCompareIds("a,b,c,d,e"), null);
  assert.deepEqual(parseCompareIds("gid://shopify/Product/1"), ["gid://shopify/Product/1"]);
});

test("page quality: share of passing checks; detail checks only when the text is known", () => {
  const good = {
    imageCount: 4,
    descriptionWords: 120,
    description: "Soft cotton tee, size S to XL. Machine washable.",
    pageDataKnown: true,
    seoTitle: "Tee",
    seoDescription: "A tee",
    collections: 2,
  };
  assert.equal(pageQuality(good).score, 100);
  const bare = { imageCount: 1, descriptionWords: 10, description: "Nice.", pageDataKnown: true, seoTitle: null, seoDescription: "", collections: 0 };
  assert.equal(pageQuality(bare).score, 0);
  // Text not stored yet: 5 checks, 4 pass → 80, no detail checks.
  const unknown = { ...good, description: null, pageDataKnown: false, seoDescription: null };
  assert.deepEqual(pageQuality(unknown).checks.map((c) => c.key), ["images", "words", "seoTitle", "seoDescription", "collection"]);
  assert.equal(pageQuality(unknown).score, 80);
});

test("margin: average over variants with a known cost", () => {
  assert.deepEqual(grossMargin([{ price: 100, cost: 40 }, { price: 50, cost: 40 }, { price: 80, cost: null }]), { margin: 0.4, withCost: 2, variants: 3 });
  assert.equal(grossMargin([{ price: 100, cost: null }]).margin, null);
  assert.equal(grossMargin([{ price: 100, cost: 0 }]).margin, null);
});

test("stock age: since last sale; else product age within history; else at least the history", () => {
  const today = "2026-10-24";
  assert.deepEqual(stockAge({ today, lastSale: "2026-10-04", createdAt: "2025-01-01", knownDays: 60 }), { days: 20, atLeast: false, sold: true });
  assert.deepEqual(stockAge({ today, lastSale: null, createdAt: "2026-10-14", knownDays: 60 }), { days: 10, atLeast: false, sold: false });
  assert.deepEqual(stockAge({ today, lastSale: null, createdAt: "2025-01-01", knownDays: 60 }), { days: 60, atLeast: true, sold: false });
  assert.deepEqual(stockAge({ today, lastSale: null, createdAt: null, knownDays: 0 }), { days: null, atLeast: false, sold: false });
});

test("best in row: highest (or lowest); none on a tie or with one value", () => {
  assert.equal(bestIndex([3, 9, null, 5]), 1);
  assert.equal(bestIndex([30, 12, 50], true), 1);
  assert.equal(bestIndex([5, 5, 1]), null);
  assert.equal(bestIndex([5, null]), null);
});
