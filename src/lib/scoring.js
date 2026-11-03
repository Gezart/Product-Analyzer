// Product metrics, statuses and money at stake — docs/PLAN.md → "Analysis logic".
// Pure functions with no imports so node:test can load them directly.

export const DEFAULT_THRESHOLDS = {
  pageProblemViewsTop: 0.4,
  pageProblemConversionRatio: 0.5,
  hiddenGemViewsBottom: 0.4,
  slowSellThrough: 0.2,
  deadDays: 90,
  stockoutCoverDays: 14,
  minViews: 20,
  /** Diagnosis: price this far above the market price (competitors' median) is flagged. */
  marketAbove: 0.1,
};

const SHARE_KEYS = new Set([
  "pageProblemViewsTop",
  "pageProblemConversionRatio",
  "hiddenGemViewsBottom",
  "slowSellThrough",
  "marketAbove",
]);

export const STATUS_WEIGHTS = {
  dead_stock: 1,
  slow_mover: 0.7,
  page_problem: 0.6,
  hidden_gem: 0.4,
  stockout_risk: 0,
  healthy: 0,
  new: 0,
  seasonal: 0,
  excluded: 0,
};

/** Keeps only valid overrides (finite numbers; shares in [0,1]; counts ≥ 0); anything else falls back to the default. */
export function sanitizeThresholds(raw) {
  const t = { ...DEFAULT_THRESHOLDS };
  if (!raw || typeof raw !== "object") return t;
  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    const v = (raw)[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    if (SHARE_KEYS.has(key) && v > 1) continue;
    if (key === "deadDays" && v === 0) continue;
    t[key] = SHARE_KEYS.has(key) ? Math.round(v * 10000) / 10000 : v;
  }
  return t;
}

/**
 * Stock and its value summed per variant. Negative stock (overselling) counts as 0.
 * Missing cost uses the variant price × 0.5 and flags the value as an estimate.
 */
export function stockFromVariants(variants) {
  let stock = 0;
  let stockValue = 0;
  let costIsEstimate = false;
  for (const v of variants) {
    const qty = Math.max(0, v.stock);
    stock += qty;
    stockValue += qty * (v.cost ?? v.price * 0.5);
    if (qty > 0 && v.cost == null) costIsEstimate = true;
  }
  return { stock, stockValue, costIsEstimate };
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));

export function computeMetrics(p) {
  const stock = Math.max(0, p.stock);
  const sold60 = p.units60 + stock;
  const daily = p.units30 / 30;
  return {
    sellThrough: sold60 > 0 ? clamp01(p.units60 / sold60) : null,
    // Sold without stock (inventory not tracked, e.g. gift cards): days of stock don't apply.
    daysOfCover: daily > 0 && !(p.sellsWhenOut && p.stock <= 0) ? stock / daily : null,
    stockValue: p.stockValue,
    costIsEstimate: p.costIsEstimate,
    trend: p.unitsPrev30 > 0 ? p.units30 / p.unitsPrev30 : null,
    conversion: p.views30 > 0 ? p.purchases30 / p.views30 : null,
  };
}

/** Value at quantile q (0–1) of a sorted ascending array, linear interpolation. */
export function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * clamp01(q);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Store-relative cut-offs over products with enough views to judge, so thresholds follow
 * each store's own distribution and low-traffic products don't skew them.
 */
export function computeBenchmarks(products, t) {
  const judged = products.filter((p) => p.views30 >= t.minViews && p.views30 > 0);
  const views = judged.map((p) => p.views30).sort((a, b) => a - b);
  const conversions = judged.map((p) => p.purchases30 / p.views30).sort((a, b) => a - b);
  return {
    viewsTopCut: quantile(views, 1 - t.pageProblemViewsTop),
    viewsBottomCut: quantile(views, t.hiddenGemViewsBottom),
    medianConversion: conversions.length ? quantile(conversions, 0.5) : null,
  };
}

/** Products younger than this aren't judged as slow movers. */
const NEW_PRODUCT_DAYS = 30;
/** A seasonal product is judged only after this many days into its season. */
export const SEASON_GRACE_DAYS = 30;
/** Statuses a seasonal product can't have out of season (or early in it): it's "seasonal" instead. */
const NOT_YET = new Set(["dead_stock", "slow_mover", "new"]);

/**
 * First matching status wins: dead stock, stock-out risk, page problem, slow mover (or new, under 30
 * days old), hidden gem, healthy.
 * `historyDays` is how many days of orders are synced; dead stock needs proof of `deadDays` without a sale,
 * capped at the product's age so new products are never dead.
 * A seasonal product (`p.season`: `{ inSeason, daysIntoSeason }`) is "seasonal" instead of dead stock, a
 * slow mover or new while out of season and in the first 30 days of its season; in season, days without
 * a sale count from the season's start.
 */
export function classify(p, m, b, t, historyDays) {
  const status = baseStatus(p, m, b, t, historyDays);
  const judged = p.season?.inSeason && p.season.daysIntoSeason >= SEASON_GRACE_DAYS;
  return p.season && !judged && NOT_YET.has(status) ? "seasonal" : status;
}

function baseStatus(p, m, b, t, historyDays) {
  if (p.stock > 0) {
    const known = p.daysSinceLastSale ?? historyDays;
    const sinceSeason = p.season?.inSeason ? p.season.daysIntoSeason : Infinity;
    const noSaleDays = Math.min(known, p.ageDays ?? Infinity, sinceSeason);
    if (noSaleDays >= t.deadDays) return "dead_stock";
  }

  const growing = m.trend == null ? p.units30 > 0 : m.trend >= 1;
  // (Products sold without stock have no days of stock, so they never run out.)
  if (m.daysOfCover != null && m.daysOfCover < t.stockoutCoverDays && growing) return "stockout_risk";

  const judged = p.views30 >= t.minViews && m.conversion != null && b.medianConversion != null;
  if (judged && p.views30 >= b.viewsTopCut && m.conversion < b.medianConversion * t.pageProblemConversionRatio) {
    return "page_problem";
  }

  // Low sell-through with stock and not dead (yet): includes products without a sale in the last
  // 60 days but sold within deadDays, and no-sale products whose history or age is too short to call dead.
  // A product listed less than 30 days ago hasn't had the time to be a slow mover: it's "new".
  const tooNew = p.ageDays != null && p.ageDays < NEW_PRODUCT_DAYS;
  if (p.stock > 0 && m.sellThrough != null && m.sellThrough < t.slowSellThrough) return tooNew ? "new" : "slow_mover";

  if (judged && p.views30 <= b.viewsBottomCut && m.conversion > b.medianConversion) return "hidden_gem";

  return "healthy";
}

export function scoreProducts(products, thresholds, historyDays = 60) {
  const t = sanitizeThresholds(thresholds);
  const b = computeBenchmarks(products, t);
  return products
    .map((p) => {
      const m = computeMetrics(p);
      const status = classify(p, m, b, t, historyDays);
      return { id: p.id, ...m, status, moneyAtStake: m.stockValue * STATUS_WEIGHTS[status] };
    })
    .sort((a, z) => z.moneyAtStake - a.moneyAtStake);
}
