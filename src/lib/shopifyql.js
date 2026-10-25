// Product views from ShopifyQL — docs/PLAN.md → "Data sources". Pure (no imports) so node:test can load it.
//
// The products dataset has per-product session counts: view_sessions (product page viewed),
// view_cart_sessions (… and added to cart), view_cart_checkout_purchase_sessions (… and bought).
// The exact syntax the store's API version accepts is checked by the ShopifyQL check page
// (/dev/shopifyql); views-sync uses the first candidate that works.

import { shiftDate } from "./dates.js";

const METRICS = "view_sessions, view_cart_sessions, view_cart_checkout_purchase_sessions";
const SUMS =
  "sum(view_sessions) AS view_sessions, sum(view_cart_sessions) AS view_cart_sessions, sum(view_cart_checkout_purchase_sessions) AS view_cart_checkout_purchase_sessions";

/** The `days` complete days before `today` (local dates, both ends included). */
export function viewRange(today, days) {
  return { from: shiftDate(today, -days), to: shiftDate(today, -1) };
}

/** A range split into chunks of at most `size` days (oldest first), so no single answer gets too big. */
export function chunkRange({ from, to }, size) {
  const out = [];
  for (let start = from; start <= to; start = shiftDate(start, size)) {
    const end = shiftDate(start, size - 1);
    out.push({ from: start, to: end < to ? end : to });
  }
  return out;
}

/** Candidate queries for daily views per product over a range (absolute dates), in the order they are tried. */
export function viewQueries({ from, to }) {
  const range = `SINCE ${from} UNTIL ${to}`;
  return [
    { id: "products", query: `FROM products SHOW ${METRICS} GROUP BY product_id, day ${range}` },
    { id: "products-sum", query: `FROM products SHOW ${SUMS} GROUP BY product_id, day ${range}` },
    { id: "products-timeseries", query: `FROM products SHOW ${METRICS} GROUP BY product_id TIMESERIES day ${range}` },
  ];
}

/** Whether an error means the app may not run the query (scope or protected customer data), so retrying won't help. */
export function isAccessDenied(text) {
  return /access denied|ACCESS_DENIED|read_reports|protected customer data/i.test(String(text));
}

/**
 * Table rows as objects keyed by column name (the API returns objects or arrays, depending on version).
 * Anything that isn't a list of rows gives no rows.
 */
export function tableRows(columns, rows) {
  const names = (columns ?? []).map((c) => c?.name);
  let list = rows;
  if (typeof rows === "string") {
    try {
      list = JSON.parse(rows);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((r) => (Array.isArray(r) ? [Object.fromEntries(names.map((n, i) => [n, r[i]]))] : r && typeof r === "object" ? [r] : []));
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
    if (!row || typeof row !== "object") continue;
    const id = first(row, ["product_id", "productId"]);
    const day = first(row, ["day", "date"]);
    const numeric = id == null ? null : String(id).match(/^(?:gid:\/\/shopify\/Product\/)?(\d+)$/)?.[1];
    const date = day == null ? null : String(day).slice(0, 10);
    if (!numeric || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
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
