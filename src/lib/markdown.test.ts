import assert from "node:assert/strict";
import { test } from "node:test";
import { discountedPrice, dueStep, floorPrice, proposeLadder, safeToWrite, stockCleared } from "./markdown.ts";

const settings = { marginFloorPct: 10, maxDiscountPct: 40 };

test("floor = cost × (1 + margin), rounded up to the cent; unknown cost → no floor", () => {
  assert.equal(floorPrice(10, 10), 11);
  assert.equal(floorPrice(9.99, 10), 10.99); // 10.989 → 10.99
  assert.equal(floorPrice(null, 10), null);
  assert.equal(floorPrice(0, 10), null);
});

test("ladder 10/20/30% off when the floor allows it", () => {
  const p = proposeLadder([{ id: "v", title: "S", price: 100, compareAtPrice: null, cost: 40 }], settings);
  assert.deepEqual(p.variants[0].stepPrices, [90, 80, 70]);
  assert.equal(p.variants[0].compareAt, 100);
  assert.equal(p.variants[0].floor, 44);
});

test("the floor caps the discount", () => {
  // cost 60 → floor 66: steps 90, 80, then 70 → stays 70; with cost 70 → floor 77: 90, 80, 77.
  const p = proposeLadder([{ id: "v", title: "S", price: 100, compareAtPrice: null, cost: 70 }], settings);
  assert.deepEqual(p.variants[0].stepPrices, [90, 80, 77]);
});

test("max discount caps the discount", () => {
  const p = proposeLadder([{ id: "v", title: "S", price: 100, compareAtPrice: null, cost: 10 }], { marginFloorPct: 10, maxDiscountPct: 15 });
  assert.deepEqual(p.variants[0].stepPrices, [90, 85, 85]);
});

test("no cost or no headroom → variant skipped with a reason", () => {
  const p = proposeLadder(
    [
      { id: "a", title: "A", price: 50, compareAtPrice: null, cost: null },
      { id: "b", title: "B", price: 11, compareAtPrice: null, cost: 10 },
    ],
    settings,
  );
  assert.equal(p.variants.length, 0);
  assert.deepEqual(p.skipped.map((s) => s.id), ["a", "b"]);
});

test("a higher original compare-at is kept for display", () => {
  const p = proposeLadder([{ id: "v", title: "S", price: 80, compareAtPrice: 120, cost: 30 }], settings);
  assert.equal(p.variants[0].compareAt, 120);
  assert.equal(p.variants[0].originalCompareAt, 120);
});

test("property: no step price is ever below the floor or above the original", () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 20000; i++) {
    const price = Math.round((0.5 + rand() * 2000) * 100) / 100;
    const cost = Math.round(rand() * price * 1.2 * 100) / 100 + 0.01;
    const margin = Math.round(rand() * 60);
    const maxDiscount = 1 + Math.round(rand() * 89);
    const p = proposeLadder([{ id: "v", title: "v", price, compareAtPrice: null, cost }], { marginFloorPct: margin, maxDiscountPct: maxDiscount });
    for (const v of p.variants) {
      for (const s of v.stepPrices) {
        assert.ok(s >= v.floor, `${s} < floor ${v.floor} (price ${price}, cost ${cost}, margin ${margin})`);
        assert.ok(s <= price);
        // Never more than the max discount off (compared in whole cents).
        assert.ok(Math.round(s * 100) >= Math.ceil(Math.round(price * 100) * (1 - maxDiscount / 100) - 1e-6), `${s} beyond max discount`);
        assert.ok(safeToWrite(s, v.floor));
      }
    }
  }
});

test("discounted price rounds down for the step but never under the floor", () => {
  assert.equal(discountedPrice(19.99, 0.1, 5, 40), 17.99);
  assert.equal(discountedPrice(19.99, 0.3, 15, 40), 15);
});

test("one step every 14 days; after the last, none", () => {
  assert.equal(dueStep(0), 0);
  assert.equal(dueStep(13), 0);
  assert.equal(dueStep(14), 1);
  assert.equal(dueStep(28), 2);
  assert.equal(dueStep(42), null);
});

test("stops when half the starting stock has sold", () => {
  assert.ok(!stockCleared(10, 6));
  assert.ok(stockCleared(10, 5));
  assert.ok(stockCleared(0, 0));
});

test("safe to write: unknown floor or below floor is refused", () => {
  assert.ok(!safeToWrite(10, null));
  assert.ok(!safeToWrite(10.99, 11));
  assert.ok(safeToWrite(11, 11));
  assert.ok(!safeToWrite(Number.NaN, 1));
});
