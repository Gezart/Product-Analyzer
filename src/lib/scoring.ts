// Product metrics, statuses and money at stake — docs/PLAN.md → "Analysis logic".
// Pure functions with no imports so node:test can load them directly.

export type Status = "dead_stock" | "stockout_risk" | "page_problem" | "slow_mover" | "hidden_gem" | "healthy";

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

export const STATUS_WEIGHTS: Record<Status, number> = {
  dead_stock: 1,
  slow_mover: 0.7,
  page_problem: 0.6,
  hidden_gem: 0.4,
  stockout_risk: 0,
  healthy: 0,
};

export type ProductInput = {
  id: string;
  /** Units in stock now. */
  stock: number;
  price: number;
  /** Unit cost from Shopify; null → price × 0.5, flagged as estimate. */
  cost: number | null;
  units30: number;
  unitsPrev30: number;
  /** Units in the last 60 days (= units30 + unitsPrev30 when both windows are known). */
  units60: number;
  views30: number;
  purchases30: number;
  /** Days since the last order with this product; null if none in the synced history. */
  daysSinceLastSale: number | null;
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

export function computeMetrics(p: ProductInput): Metrics {
  const sold60 = p.units60 + p.stock;
  const daily = p.units30 / 30;
  const costIsEstimate = p.cost == null;
  const unitCost = p.cost ?? p.price * 0.5;
  return {
    sellThrough: sold60 > 0 ? p.units60 / sold60 : null,
    daysOfCover: daily > 0 ? p.stock / daily : null,
    stockValue: Math.max(0, p.stock) * unitCost,
    costIsEstimate,
    trend: p.unitsPrev30 > 0 ? p.units30 / p.unitsPrev30 : null,
    conversion: p.views30 > 0 ? p.purchases30 / p.views30 : null,
  };
}

/** Value at quantile q (0–1) of a sorted ascending array, linear interpolation. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Store-relative cut-offs: thresholds follow each store's own distribution, not fixed numbers. */
export function computeBenchmarks(products: ProductInput[], t: Thresholds): Benchmarks {
  const views = products.map((p) => p.views30).sort((a, b) => a - b);
  const conversions = products
    .filter((p) => p.views30 >= t.minViews)
    .map((p) => p.purchases30 / p.views30)
    .sort((a, b) => a - b);
  return {
    viewsTopCut: quantile(views, 1 - t.pageProblemViewsTop),
    viewsBottomCut: quantile(views, t.hiddenGemViewsBottom),
    medianConversion: conversions.length ? quantile(conversions, 0.5) : null,
  };
}

/**
 * First matching status wins: dead stock, stock-out risk, page problem, slow mover, hidden gem, healthy.
 * `historyDays` is how many days of orders are synced; dead stock needs proof of `deadDays` without a sale.
 */
export function classify(p: ProductInput, m: Metrics, b: Benchmarks, t: Thresholds, historyDays: number): Status {
  if (p.stock > 0) {
    const noSaleDays = p.daysSinceLastSale ?? (historyDays >= t.deadDays ? historyDays : null);
    if (noSaleDays != null && noSaleDays >= t.deadDays) return "dead_stock";
  }

  const growing = m.trend == null ? p.units30 > 0 : m.trend >= 1;
  if (m.daysOfCover != null && m.daysOfCover < t.stockoutCoverDays && growing) return "stockout_risk";

  const enoughViews = p.views30 >= t.minViews && m.conversion != null && b.medianConversion != null;
  if (
    enoughViews &&
    p.views30 > 0 &&
    p.views30 >= b.viewsTopCut &&
    m.conversion! < b.medianConversion! * t.pageProblemConversionRatio
  ) {
    return "page_problem";
  }

  // No sale in a history shorter than deadDays: can't call it dead yet, treat as slow.
  if (p.stock > 0 && m.sellThrough != null && m.sellThrough < t.slowSellThrough) return "slow_mover";

  if (enoughViews && p.views30 <= b.viewsBottomCut && m.conversion! > b.medianConversion!) return "hidden_gem";

  return "healthy";
}

export function scoreProducts(
  products: ProductInput[],
  thresholds: Partial<Thresholds> = {},
  historyDays = 60,
): ScoreResult[] {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const b = computeBenchmarks(products, t);
  return products
    .map((p) => {
      const m = computeMetrics(p);
      const status = classify(p, m, b, t, historyDays);
      return { id: p.id, ...m, status, moneyAtStake: m.stockValue * STATUS_WEIGHTS[status] };
    })
    .sort((a, z) => z.moneyAtStake - a.moneyAtStake);
}
