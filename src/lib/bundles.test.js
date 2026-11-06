import assert from "node:assert/strict";
import { test } from "node:test";
import { bundleEffect, endReason, maxBundlePct, ordersTogether, suggestBundles, validateBundle } from "./bundles.js";

const settings = { marginFloorPct: 20, maxDiscountPct: 40 };

test("the bundle discount never takes a variant under its floor", () => {
  // Cost 50, margin floor 20% → floor 60. Price 100 allows 40% off; price 80 allows 25%.
  assert.deepEqual(maxBundlePct([{ price: 100, cost: 50 }], settings), { pct: 40, reason: null });
  assert.deepEqual(maxBundlePct([{ price: 100, cost: 50 }, { price: 80, cost: 50 }], settings), { pct: 25, reason: null });
  // The store's max discount caps it.
  assert.equal(maxBundlePct([{ price: 200, cost: 10 }], settings).pct, 40);
  // Rounding: 61.99 with floor 60 allows 3% at most (under 5%: none).
  assert.match(maxBundlePct([{ price: 61.99, cost: 50 }], settings).reason, /less than 5%/);
  // Odd prices: the whole percent is checked in cents after rounding down.
  const odd = maxBundlePct([{ price: "19.99", cost: "11.00" }], { marginFloorPct: 10, maxDiscountPct: 50 });
  assert.ok(Math.floor(1999 * (100 - odd.pct) / 100) >= 1210, JSON.stringify(odd));
  assert.match(maxBundlePct([{ price: 100, cost: null }], settings).reason, /no unit cost/);
  assert.match(maxBundlePct([{ price: 60, cost: 50 }], settings).reason, /already at or below/);
});

test("a bundle the merchant asks for is checked", () => {
  assert.deepEqual(validateBundle({ productId: "a", partnerId: "b", pct: 15 }, 25), { ok: true, value: { productId: "a", partnerId: "b", pct: 15 } });
  assert.match(validateBundle({ productId: "a", partnerId: "a", pct: 15 }, 25).error, /two different/);
  assert.match(validateBundle({ productId: "a", partnerId: "b", pct: 30 }, 25).error, /up to 25%/);
  assert.match(validateBundle({ productId: "a", partnerId: "b", pct: 2 }, 25).error, /5% to 50%/);
  assert.match(validateBundle({ productId: "a", partnerId: "b", pct: 10.5 }, 25).error, /5% to 50%/);
  assert.match(validateBundle({ productId: "a", pct: 10 }, 25).error, /two products/);
});

const product = (id, change) => ({ id, gid: `g${id}`, title: `P${id}`, status: "healthy", rising: false, stock: 10, units30: 0, moneyAtStake: 0, collections: [], productType: null, maxPct: 30, bundled: false, ...change });

test("suggestions pair stuck products with selling ones that fit, each partner once", () => {
  const products = [
    product("scarf", { status: "dead_stock", moneyAtStake: 900, collections: ["winter"] }),
    product("gloves", { status: "slow_mover", moneyAtStake: 400, collections: ["winter"] }),
    product("jacket", { units30: 40, collections: ["winter"] }),
    product("boots", { units30: 25, collections: ["winter"] }),
    product("mug", { units30: 90, collections: ["kitchen"] }), // sells most, but nothing in common
    product("hat", { status: "dead_stock", moneyAtStake: 100, maxPct: 3 }), // floor too tight
    product("socks", { status: "dead_stock", moneyAtStake: 50, stock: 0 }), // nothing to sell
  ];
  const together = ordersTogether([
    { orderGid: "o1", productGid: "ggloves" },
    { orderGid: "o1", productGid: "gboots" },
  ]);
  const out = suggestBundles(products, together);
  assert.deepEqual(out.map((s) => [s.product.id, s.partner.id, s.pct]), [
    ["scarf", "jacket", 15],
    ["gloves", "boots", 15],
  ]);
  assert.equal(out[1].why, "Bought together in 1 order; Pboots sold 25 in 30 days.");
  // Already in a bundle: left out on both sides.
  assert.deepEqual(suggestBundles(products.map((p) => (p.id === "jacket" ? { ...p, bundled: true } : p)), together).map((s) => s.partner.id), ["boots"]);
});

test("what a bundle did: orders with both, and the stuck product's sales a day before and since", () => {
  const lines = [
    { orderGid: "o1", productGid: "scarf", date: "2026-11-10", quantity: 1, revenue: 17 },
    { orderGid: "o1", productGid: "jacket", date: "2026-11-10", quantity: 1, revenue: 120 },
    { orderGid: "o2", productGid: "scarf", date: "2026-11-11", quantity: 2, revenue: 40 }, // without the jacket
    { orderGid: "o3", productGid: "scarf", date: "2026-10-20", quantity: 3, revenue: 60 }, // before
    { orderGid: "o4", productGid: "scarf", date: "2026-11-12", quantity: 0, revenue: 0 }, // cancelled
    { orderGid: "o4", productGid: "jacket", date: "2026-11-12", quantity: 1, revenue: 120 },
  ];
  const effect = bundleEffect(lines, { productGid: "scarf", partnerGid: "jacket", startedOn: "2026-11-05", today: "2026-11-15" });
  assert.deepEqual(effect, { orders: 1, units: 1, revenue: 17, days: 10, perDaySince: 0.3, perDayBefore: 0.1 });
});

test("a running bundle ends when it can't go on", () => {
  const ok = { productActive: true, partnerActive: true, stock: 4, maxPct: 20, pct: 15, included: true };
  assert.equal(endReason(ok), null);
  assert.equal(endReason({ ...ok, stock: 0 }), "sold_out");
  assert.equal(endReason({ ...ok, partnerActive: false }), "product_gone");
  assert.equal(endReason({ ...ok, maxPct: 10 }), "floor");
  assert.equal(endReason({ ...ok, included: false }), "plan");
});
