import assert from "node:assert/strict";
import { test } from "node:test";
import { tableRows, viewQueries, viewRows } from "./shopifyql.js";

test("view queries: daily per product over the asked days, ending yesterday", () => {
  const q = viewQueries(90);
  assert.equal(q[0].query, "FROM products SHOW view_sessions, view_cart_sessions, view_cart_checkout_purchase_sessions GROUP BY product_id, day SINCE -90d UNTIL yesterday");
  assert.deepEqual(q.map((x) => x.id), ["products", "products-sum", "products-timeseries"]);
});

test("table rows: arrays (with columns) or objects, even as a JSON string", () => {
  const columns = [{ name: "product_id" }, { name: "day" }, { name: "view_sessions" }];
  assert.deepEqual(tableRows(columns, [[1, "2026-10-01", 5]]), [{ product_id: 1, day: "2026-10-01", view_sessions: 5 }]);
  assert.deepEqual(tableRows(columns, '[{"product_id":1}]'), [{ product_id: 1 }]);
  assert.deepEqual(tableRows(columns, null), []);
});

test("view rows: product GID and local date; totals and bad rows skipped; counts never negative", () => {
  const rows = viewRows([
    { product_id: 123, day: "2026-10-01", view_sessions: "40", view_cart_sessions: 4, view_cart_checkout_purchase_sessions: 1 },
    { product_id: "gid://shopify/Product/456", day: "2026-10-02T00:00:00", view_sessions: 7 },
    { product_id: null, day: "2026-10-01", view_sessions: 900 },
    { product_id: 789, day: null, view_sessions: 3 },
    { product_id: 5, day: "2026-10-03", view_sessions: -2 },
  ]);
  assert.deepEqual(rows, [
    { productGid: "gid://shopify/Product/123", date: "2026-10-01", views: 40, carts: 4, purchases: 1 },
    { productGid: "gid://shopify/Product/456", date: "2026-10-02", views: 7, carts: 0, purchases: 0 },
    { productGid: "gid://shopify/Product/5", date: "2026-10-03", views: 0, carts: 0, purchases: 0 },
  ]);
});
