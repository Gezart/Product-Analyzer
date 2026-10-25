import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkRange, isAccessDenied, tableRows, viewQueries, viewRange, viewRows } from "./shopifyql.js";

test("range: the complete days before today; split in chunks, oldest first", () => {
  assert.deepEqual(viewRange("2026-10-25", 7), { from: "2026-10-18", to: "2026-10-24" });
  assert.deepEqual(viewRange("2026-03-01", 1), { from: "2026-02-28", to: "2026-02-28" });
  const chunks = chunkRange(viewRange("2026-10-25", 90), 7);
  assert.equal(chunks.length, 13);
  assert.deepEqual(chunks[0], { from: "2026-07-27", to: "2026-08-02" });
  assert.deepEqual(chunks.at(-1), { from: "2026-10-19", to: "2026-10-24" });
  assert.deepEqual(chunkRange({ from: "2026-10-18", to: "2026-10-24" }, 7), [{ from: "2026-10-18", to: "2026-10-24" }]);
});

test("view queries: absolute dates, daily per product", () => {
  const q = viewQueries({ from: "2026-07-27", to: "2026-08-02" });
  assert.equal(q[0].query, "FROM products SHOW view_sessions, view_cart_sessions, view_cart_checkout_purchase_sessions GROUP BY product_id, day SINCE 2026-07-27 UNTIL 2026-08-02");
  assert.deepEqual(q.map((x) => x.id), ["products", "products-sum", "products-timeseries"]);
});

test("access denied is recognised (no retry); other errors aren't", () => {
  assert.equal(isAccessDenied("Access denied for shopifyqlQuery field. Required access: `read_reports` access scope."), true);
  assert.equal(isAccessDenied("Http request error, no response available: fetch failed"), false);
});

test("table rows: arrays (with columns) or objects, even as a JSON string; anything else gives no rows", () => {
  const columns = [{ name: "product_id" }, { name: "day" }, { name: "view_sessions" }];
  assert.deepEqual(tableRows(columns, [[1, "2026-10-01", 5]]), [{ product_id: 1, day: "2026-10-01", view_sessions: 5 }]);
  assert.deepEqual(tableRows(columns, '[{"product_id":1}]'), [{ product_id: 1 }]);
  assert.deepEqual(tableRows(columns, null), []);
  assert.deepEqual(tableRows(columns, { a: 1 }), []);
  assert.deepEqual(tableRows(columns, "not json"), []);
  assert.deepEqual(tableRows(columns, [null, 3, { product_id: 2 }]), [{ product_id: 2 }]);
});

test("view rows: product GID and local date; totals and bad rows skipped; counts never negative", () => {
  const rows = viewRows([
    { product_id: 123, day: "2026-10-01", view_sessions: "40", view_cart_sessions: 4, view_cart_checkout_purchase_sessions: 1 },
    { product_id: "gid://shopify/Product/456", day: "2026-10-02T00:00:00", view_sessions: 7 },
    { product_id: null, day: "2026-10-01", view_sessions: 900 },
    { product_id: 789, day: null, view_sessions: 3 },
    { product_id: "123.0", day: "2026-10-01", view_sessions: 3 },
    null,
    { product_id: 5, day: "2026-10-03", view_sessions: -2 },
  ]);
  assert.deepEqual(rows, [
    { productGid: "gid://shopify/Product/123", date: "2026-10-01", views: 40, carts: 4, purchases: 1 },
    { productGid: "gid://shopify/Product/456", date: "2026-10-02", views: 7, carts: 0, purchases: 0 },
    { productGid: "gid://shopify/Product/5", date: "2026-10-03", views: 0, carts: 0, purchases: 0 },
  ]);
});
