import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeReturns } from "./return-stats.js";

test("a month's returns: units sold are kept + returned; per product the same; names and missing products", () => {
  const r = summarizeReturns({
    kept: 334,
    returned: 14,
    refunded: 560.004,
    byProduct: [
      { productGid: "gid://shopify/Product/1", returned: 12, refunded: 480 },
      { productGid: "gid://shopify/Product/9", returned: 2, refunded: 80.55 },
      { productGid: "gid://shopify/Product/3", returned: 0, refunded: 0 },
    ],
    keptByProduct: new Map([["gid://shopify/Product/1", 54]]),
    products: new Map([["gid://shopify/Product/1", { id: "shirt", title: "Linen shirt" }]]),
    reasons: [{ handle: "too-small", count: 7 }, { handle: "damaged", count: 3 }, { handle: "x", count: 0 }],
    names: new Map([["too-small", "Too Small"]]),
  });
  assert.equal(r.sold, 348);
  assert.equal(r.refunded, 560);
  assert.equal(Math.round(r.rate * 1000) / 1000, 0.04);
  assert.deepEqual(r.reasons, [{ handle: "too-small", name: "Too Small", count: 7 }, { handle: "damaged", name: "damaged", count: 3 }]);
  assert.deepEqual(r.products, [
    { productGid: "gid://shopify/Product/1", productId: "shirt", title: "Linen shirt", returned: 12, sold: 66, rate: 12 / 66, refunded: 480 },
    { productGid: "gid://shopify/Product/9", productId: null, title: "Deleted product", returned: 2, sold: 2, rate: 1, refunded: 80.55 },
  ]);
});

test("a month with nothing sold or returned has no rate", () => {
  assert.deepEqual(summarizeReturns({ kept: 0, returned: 0, refunded: 0 }), { refunded: 0, returned: 0, sold: 0, rate: null, reasons: [], products: [] });
});
