// Launch tracker (docs/TASKS.md, Phase 3c): new products followed through their first 7, 14 and 30
// days against the store, with an early warning when a launch isn't working. Pure (relative imports
// only) so node:test can load it.

import { daysBetween, shiftDate } from "./dates.js";
import { median } from "./diagnosis.js";

/** The checkpoints, in days since the product was created. */
export const CHECKPOINTS = [7, 14, 30];

export const RULES = {
  /** A launch is followed this long (the last checkpoint). */
  days: 30,
  /** Visits before the page can be judged (add-to-cart rate). */
  minViews: 30,
  /** Products with at least this many visits in 30 days set the store's add-to-cart rate. */
  benchmarkViews: 20,
  /** Below this share of the store's median add-to-cart rate: an early page problem. */
  pageProblem: 0.5,
  /** At this share of it or more, with a sale: a strong start. */
  strong: 1.5,
  /** Below this share of the visits a typical product gets in as many days: no traffic. */
  noTraffic: 0.25,
};

export const STATUS = {
  strong: { label: "Strong start", tone: "good" },
  on_track: { label: "On track", tone: "info" },
  page_problem: { label: "Early page problem", tone: "bad" },
  no_traffic: { label: "Few visits", tone: "warn" },
  not_enough_data: { label: "Too early to tell", tone: "neutral" },
};

/** What to do next per status (the page and the inbox). */
export const NEXT_STEP = {
  strong: "Keep it in stock and give it a good place in its collections.",
  on_track: "Nothing to fix now; the next check tells more.",
  page_problem: "Visitors come but few add it to the cart: check the photos, the price and the description.",
  no_traffic: "Few shoppers find it: add it to a collection, move it up, or feature it on the home page.",
  not_enough_data: "Too few visits to judge the page yet.",
};

/** The products' launch day and how many days ago that was (store dates "YYYY-MM-DD"). */
export const daysSince = (createdOn, today) => daysBetween(createdOn, today);

/**
 * The checkpoint to record now: the latest one reached that isn't recorded yet (a product found late
 * gets only its latest checkpoint, not every missed one), or null.
 */
export function dueCheckpoint(createdOn, today, recorded = []) {
  const age = daysSince(createdOn, today);
  const reached = CHECKPOINTS.filter((day) => age >= day);
  const latest = reached.at(-1);
  if (latest == null || recorded.some((day) => day >= latest)) return null;
  return latest;
}

/**
 * A launch's numbers over its first `days` days (or up to `today`, whichever is first): daily rows
 * `{ date, viewSessions, cartSessions, purchaseSessions, units, revenue }`.
 */
export function launchWindow(rows, createdOn, days, today) {
  const last = shiftDate(createdOn, days - 1) < today ? shiftDate(createdOn, days - 1) : shiftDate(today, -1);
  const sum = { views: 0, carts: 0, buyers: 0, units: 0, revenue: 0 };
  for (const r of rows) {
    if (r.date < createdOn || r.date > last) continue;
    sum.views += r.viewSessions ?? 0;
    sum.carts += r.cartSessions ?? 0;
    sum.buyers += r.purchaseSessions ?? 0;
    sum.units += r.units ?? 0;
    sum.revenue += Number(r.revenue ?? 0);
  }
  return { ...sum, revenue: Math.round(sum.revenue * 100) / 100, days: Math.max(0, daysBetween(createdOn, last) + 1), cartRate: sum.views ? sum.carts / sum.views : null };
}

/**
 * The store's yardsticks from each product's last 30 days (`{ views, carts }`): the median add-to-cart
 * rate of products with enough visits, and the median visits per product per day. `viewsKnown` false
 * when the store has no visit data at all (launches are then judged on sales only).
 */
export function storeBenchmarks(products, rules = RULES) {
  const viewsKnown = products.some((p) => p.views > 0);
  const rated = products.filter((p) => p.views >= rules.benchmarkViews).map((p) => p.carts / p.views);
  return {
    viewsKnown,
    cartRate: rated.length ? median(rated) : null,
    dailyViews: viewsKnown ? median(products.map((p) => p.views / 30)) : null,
  };
}

const pct = (rate) => `${(rate * 100).toFixed(1)}%`;

/**
 * How a launch is doing after `days` days: `{ status, reason }`. Few visits against what a typical
 * product gets in as many days → no_traffic; enough visits but an add-to-cart rate under half the
 * store's → page_problem; 1.5× the store's with a sale → strong; otherwise on_track, or not_enough_data
 * while visits are too few to judge. Without visit data: sales only.
 */
export function judgeLaunch(window, store, rules = RULES) {
  const days = window.days;
  if (!store.viewsKnown) {
    return window.units > 0
      ? { status: "on_track", reason: `${window.units} sold in ${days} days (no visit data to compare).` }
      : { status: "not_enough_data", reason: `No sales in ${days} days, and no visit data to compare.` };
  }
  const expected = store.dailyViews != null ? store.dailyViews * days : null;
  if (expected && window.views < rules.minViews && window.views < expected * rules.noTraffic) {
    return { status: "no_traffic", reason: `${window.views} visits in ${days} days; a typical product gets about ${Math.round(expected)}.` };
  }
  if (window.views < rules.minViews || window.cartRate == null) {
    return { status: "not_enough_data", reason: `${window.views} visits in ${days} days; ${rules.minViews} are needed to judge the page.` };
  }
  const visits = `${window.views} visits, ${pct(window.cartRate)} added to cart`;
  if (store.cartRate == null) {
    return window.units > 0 ? { status: "on_track", reason: `${visits}, ${window.units} sold.` } : { status: "not_enough_data", reason: `${visits}; the store has too few visits to compare.` };
  }
  const versus = `(store: ${pct(store.cartRate)})`;
  if (window.cartRate < store.cartRate * rules.pageProblem) return { status: "page_problem", reason: `${visits} ${versus}.` };
  if (window.cartRate >= store.cartRate * rules.strong && window.units > 0) return { status: "strong", reason: `${visits} ${versus}, ${window.units} sold.` };
  return { status: "on_track", reason: `${visits} ${versus}.` };
}

/** Statuses the inbox tells about at a checkpoint (the others wait for the next one). */
export const NOTIFY = ["page_problem", "no_traffic", "strong"];
