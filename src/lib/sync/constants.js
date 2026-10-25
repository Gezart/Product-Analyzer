// Pure (relative imports only) so node:test can load it directly.

import { DAY_MS } from "../dates.js";

/** Days of order history synced (Shopify's default `read_orders` window). */
export const ORDER_DAYS = 60;

/** A local date as stored in the orders step's cursor (YYYY-MM-DD); anything else is ignored. */
export function isLocalDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Days of order history we actually know, counted back from `today` (both YYYY-MM-DD local dates).
 * Starts at the imported window's first day. Without live order sync, nothing after the import is
 * known, so it is capped at the imported window.
 */
export function knownOrderDays({ windowStart, today, live }) {
  if (!isLocalDate(windowStart)) return 0;
  const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(windowStart)) / DAY_MS));
  return live ? days : Math.min(days, ORDER_DAYS);
}
