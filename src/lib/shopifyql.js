// Product views from ShopifyQL — docs/PLAN.md → "Data sources". Pure (no imports) so node:test can load it.
//
// The products dataset has per-product session counts: view_sessions (product page viewed),
// view_cart_sessions (… and added to cart), view_cart_checkout_purchase_sessions (… and bought).
// The exact syntax the store's API version accepts is checked by the ShopifyQL check page
// (/dev/shopifyql); views-sync uses the first candidate that works.

const METRICS = "view_sessions, view_cart_sessions, view_cart_checkout_purchase_sessions";
const SUMS =
  "sum(view_sessions) AS view_sessions, sum(view_cart_sessions) AS view_cart_sessions, sum(view_cart_checkout_purchase_sessions) AS view_cart_checkout_purchase_sessions";

/** Candidate queries for `days` days of daily views per product, in the order they are tried. */
export function viewQueries(days) {
  const range = `SINCE -${days}d UNTIL yesterday`;
  return [
    { id: "products", query: `FROM products SHOW ${METRICS} GROUP BY product_id, day ${range}` },
    { id: "products-sum", query: `FROM products SHOW ${SUMS} GROUP BY product_id, day ${range}` },
    { id: "products-timeseries", query: `FROM products SHOW ${METRICS} GROUP BY product_id TIMESERIES day ${range}` },
  ];
}

/** Table rows as objects keyed by column name (the API returns objects or arrays, depending on version). */
export function tableRows(columns, rows) {
  const names = (columns ?? []).map((c) => c.name);
  const list = typeof rows === "string" ? JSON.parse(rows) : (rows ?? []);
  return list.map((r) => (Array.isArray(r) ? Object.fromEntries(names.map((n, i) => [n, r[i]])) : r));
}

const count = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const first = (row, keys) => keys.map((k) => row[k]).find((v) => v != null);

/**
 * Daily views per product from table rows: { productGid, date, views, carts, purchases }. Rows without a
 * product or a day are skipped (e.g. totals); missing counts are 0.
 */
export function viewRows(objects) {
  const out = [];
  for (const row of objects) {
    const id = first(row, ["product_id", "productId"]);
    const day = first(row, ["day", "date"]);
    if (id == null || day == null) continue;
    const numeric = String(id).match(/(\d+)$/)?.[1];
    const date = String(day).slice(0, 10);
    if (!numeric || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      productGid: `gid://shopify/Product/${numeric}`,
      date,
      views: count(first(row, ["view_sessions"])),
      carts: count(first(row, ["view_cart_sessions", "cart_sessions"])),
      purchases: count(first(row, ["view_cart_checkout_purchase_sessions", "view_purchase_sessions", "purchase_sessions"])),
    });
  }
  return out;
}
