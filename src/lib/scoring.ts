// Product metrics, statuses and money at stake — docs/PLAN.md → "Analysis logic".
// Pure functions with no imports so node:test can load them directly.

export type Status =
  | "dead_stock"
  | "stockout_risk"
  | "page_problem"
  | "slow_mover"
  | "hidden_gem"
  | "healthy"
  /** Inactive or in an excluded collection; written so old scores don't linger. */
  | "excluded";

export type Thresholds = {
  /** Page problem: views in the top X of the store (0.4 = top 40%). */
  pageProblemViewsTop: number;
  /** Page problem: conversion below X × store median. */
  pageProblemConversionRatio: number;
  /** Hidden gem: views in the bottom X of the store. */
  hiddenGemViewsBottom: number;
  /** Slow mover: 60-day sell-through below X. */
  slowSellThrough: number;
  /** Dead stock: no sale for X days. */
  deadDays: number;
  /** Stock-out risk: days of cover below X. */
  stockoutCoverDays: number;
  /** Conversion-based statuses need at least X view sessions in 30 days. */
  minViews: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  pageProblemViewsTop: 0.4,
  pageProblemConversionRatio: 0.5,
  hiddenGemViewsBottom: 0.4,
  slowSellThrough: 0.2,
  deadDays: 90,
  stockoutCoverDays: 14,
  minViews: 20,
};

const SHARE_KEYS = new Set<keyof Thresholds>([
  "pageProblemViewsTop",
  "pageProblemConversionRatio",
  "hiddenGemViewsBottom",
  "slowSellThrough",
]);

export const STATUS_WEIGHTS: Record<Status, number> = {
  dead_stock: 1,
  slow_mover: 0.7,
  page_problem: 0.6,
  hidden_gem: 0.4,
  stockout_risk: 0,
  healthy: 0,
  excluded: 0,
};

/** Keeps only valid overrides (finite numbers; shares in [0,1]; counts ≥ 0); anything else falls back to the default. */
export function sanitizeThresholds(raw: unknown): Thresholds {
  const t = { ...DEFAULT_THRESHOLDS };
  if (!raw || typeof raw !== "object") return t;
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    if (SHARE_KEYS.has(key) && v > 1) continue;
    if (key === "deadDays" && v === 0) continue;
    t[key] = v;
  }
  return t;
}

export type VariantStock = { stock: number; price: number; cost: number | null };

/**
 * Stock and its value summed per variant. Negative stock (overselling) counts as 0.
 * Missing cost uses the variant price × 0.5 and flags the value as an estimate.
 */
export function stockFromVariants(variants: VariantStock[]) {
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

export type ProductInput = {
  id: string;
  /** Units in stock now (≥ 0). */
  stock: number;
  stockValue: number;
  costIsEstimate: boolean;
  units30: number;
  unitsPrev30: number;
  /** Units in the last 60 days. */
  units60: number;
  views30: number;
  purchases30: number;
  /** Days since the last order with this product; null if none in the synced history. */
  daysSinceLastSale: number | null;
  /** Days since the product was created; null if unknown. */
  ageDays: number | null;
};

export type Metrics = {
  sellThrough: number | null;
  daysOfCover: number | null;
  stockValue: number;
  costIsEstimate: boolean;
  /** units30 / unitsPrev30; null when the previous window had no sales. */
  trend: number | null;
  conversion: number | null;
};

export type Benchmarks = {
  viewsTopCut: number;
  viewsBottomCut: number;
  medianConversion: number | null;
};

export type ScoreResult = Metrics & { id: string; status: Status; moneyAtStake: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function computeMetrics(p: ProductInput): Metrics {
  const stock = Math.max(0, p.stock);
  const sold60 = p.units60 + stock;
  const daily = p.units30 / 30;
  return {
    sellThrough: sold60 > 0 ? clamp01(p.units60 / sold60) : null,
    daysOfCover: daily > 0 ? stock / daily : null,
    stockValue: p.stockValue,
    costIsEstimate: p.costIsEstimate,
    trend: p.unitsPrev30 > 0 ? p.units30 / p.unitsPrev30 : null,
    conversion: p.views30 > 0 ? p.purchases30 / p.views30 : null,
  };
}

/** Value at quantile q (0–1) of a sorted ascending array, linear interpolation. */
export function quantile(sorted: number[], q: number): number {
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
export function computeBenchmarks(products: ProductInput[], t: Thresholds): Benchmarks {
  const judged = products.filter((p) => p.views30 >= t.minViews && p.views30 > 0);
  const views = judged.map((p) => p.views30).sort((a, b) => a - b);
  const conversions = judged.map((p) => p.purchases30 / p.views30).sort((a, b) => a - b);
  return {
    viewsTopCut: quantile(views, 1 - t.pageProblemViewsTop),
    viewsBottomCut: quantile(views, t.hiddenGemViewsBottom),
    medianConversion: conversions.length ? quantile(conversions, 0.5) : null,
  };
}

/**
 * First matching status wins: dead stock, stock-out risk, page problem, slow mover, hidden gem, healthy.
 * `historyDays` is how many days of orders are synced; dead stock needs proof of `deadDays` without a sale,
 * capped at the product's age so new products are never dead.
 */
export function classify(p: ProductInput, m: Metrics, b: Benchmarks, t: Thresholds, historyDays: number): Status {
  if (p.stock > 0) {
    const known = p.daysSinceLastSale ?? historyDays;
    const noSaleDays = p.ageDays != null ? Math.min(known, p.ageDays) : known;
    if (noSaleDays >= t.deadDays) return "dead_stock";
  }

  const growing = m.trend == null ? p.units30 > 0 : m.trend >= 1;
  if (m.daysOfCover != null && m.daysOfCover < t.stockoutCoverDays && growing) return "stockout_risk";

  const judged = p.views30 >= t.minViews && m.conversion != null && b.medianConversion != null;
  if (judged && p.views30 >= b.viewsTopCut && m.conversion! < b.medianConversion! * t.pageProblemConversionRatio) {
    return "page_problem";
  }

  // Low sell-through with stock and not dead (yet): includes products without a sale in the last
  // 60 days but sold within deadDays, and no-sale products whose history or age is too short to call dead.
  if (p.stock > 0 && m.sellThrough != null && m.sellThrough < t.slowSellThrough) return "slow_mover";

  if (judged && p.views30 <= b.viewsBottomCut && m.conversion! > b.medianConversion!) return "hidden_gem";

  return "healthy";
}

export function scoreProducts(products: ProductInput[], thresholds?: unknown, historyDays = 60): ScoreResult[] {
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
