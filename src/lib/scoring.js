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
/** A seasonal product is judged only after this many days into its season (half a shorter season). */
export const SEASON_GRACE_DAYS = 30;
export const seasonGraceDays = (seasonDays) => Math.min(SEASON_GRACE_DAYS, Math.floor((seasonDays ?? 2 * SEASON_GRACE_DAYS) / 2));

/** Out of season, or still in its grace days: the product waits for its season and isn't judged on sales. */
export function seasonWaiting(season) {
  return Boolean(season) && !(season.inSeason && season.daysIntoSeason >= seasonGraceDays(season.seasonDays));
}

/**
 * First matching status wins: dead stock, stock-out risk, page problem, slow mover (or new, under 30
 * days old), hidden gem, healthy.
 * `historyDays` is how many days of orders are synced; dead stock needs proof of `deadDays` without a sale,
 * capped at the product's age so new products are never dead.
 * A seasonal product (`p.season`: `{ inSeason, daysIntoSeason, seasonDays }`) waiting for its season (out
 * of it, or in its first 30 days) is never dead stock, a slow mover or new: it's "seasonal"; every other
 * status still applies. In season, days without a sale count from the season's start, and a season
 * shorter than `deadDays` makes it dead stock when unsold through all of it but its last day.
 */
export function classify(p, m, b, t, historyDays) {
  const waiting = seasonWaiting(p.season);
  if (p.stock > 0 && !waiting) {
    const known = p.daysSinceLastSale ?? historyDays;
    const sinceSeason = p.season?.inSeason ? p.season.daysIntoSeason : Infinity;
    const noSaleDays = Math.min(known, p.ageDays ?? Infinity, sinceSeason);
    const deadDays = p.season?.seasonDays ? Math.min(t.deadDays, p.season.seasonDays - 1) : t.deadDays;
    if (noSaleDays >= deadDays) return "dead_stock";
  }
  const status = afterDeadStock(p, m, b, t);
  return waiting && (status === "slow_mover" || status === "new") ? "seasonal" : status;
}

function afterDeadStock(p, m, b, t) {
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

/** Rising stars: sales up this much over the 30 days before, with at least this many units. */
export const RISING = { growth: 1.2, minUnits: 5 };

/**
 * A rising star: sold at least 5 units in the last 30 days, 20% or more above the 30 days before (which
 * had sales), and converting at least as well as the store's median when its visits are known. Never a
 * product that's dead stock, a slow mover or waiting for its season.
 */
export function isRisingStar(p, m, b, status, t = DEFAULT_THRESHOLDS) {
  if (["dead_stock", "slow_mover", "seasonal", "excluded", "over_limit"].includes(status)) return false;
  if (p.units30 < RISING.minUnits || !(p.unitsPrev30 > 0) || p.units30 < p.unitsPrev30 * RISING.growth) return false;
  // Conversion counts only with enough visits to judge and a store median to compare with.
  if (b.medianConversion != null && p.views30 >= t.minViews && m.conversion != null && m.conversion < b.medianConversion) return false;
  return true;
}

export function scoreProducts(products, thresholds, historyDays = 60) {
  const t = sanitizeThresholds(thresholds);
  const b = computeBenchmarks(products, t);
  return products
    .map((p) => {
      const m = computeMetrics(p);
      const status = classify(p, m, b, t, historyDays);
      return { id: p.id, ...m, status, rising: isRisingStar(p, m, b, status, t), moneyAtStake: m.stockValue * STATUS_WEIGHTS[status] };
    })
    .sort((a, z) => z.moneyAtStake - a.moneyAtStake);
}
