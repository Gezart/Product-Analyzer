// Catalog health summary — docs/PLAN.md module 2. Pure (relative imports only) so node:test can load it.

import { round2 } from "./dates.js";

export const STATUS_ORDER = ["dead_stock", "slow_mover", "page_problem", "hidden_gem", "stockout_risk", "healthy", "new"];

/** Statuses whose stock counts as "money stuck in stock". */
const STUCK = new Set(["dead_stock", "slow_mover"]);
/** Places in the action list kept for stock-out risks, which carry no money at stake but can't wait. */
const STOCKOUT_PLACES = 3;

export function summarize(rows, topN = 10) {
  const scored = rows.filter((r) => STATUS_ORDER.includes(r.status));
  const stuck = scored.filter((r) => STUCK.has(r.status));
  const byStatus = STATUS_ORDER.map((status) => {
    const group = scored.filter((r) => r.status === status);
    return {
      status,
      count: group.length,
      stockValue: round2(group.reduce((sum, r) => sum + r.stockValue, 0)),
      moneyAtStake: round2(group.reduce((sum, r) => sum + r.moneyAtStake, 0)),
    };
  });
  // Products with money at stake first (most first), then stock-out risks (fewest days left first),
  // which keep up to 3 places so a reorder never drops off the list.
  const atStake = scored.filter((r) => r.moneyAtStake > 0 && r.status !== "stockout_risk").sort((a, b) => b.moneyAtStake - a.moneyAtStake);
  const stockouts = scored.filter((r) => r.status === "stockout_risk").sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));
  const top = [...atStake.slice(0, topN - Math.min(STOCKOUT_PLACES, stockouts.length)), ...stockouts].slice(0, topN);
  return {
    moneyStuck: round2(stuck.reduce((sum, r) => sum + r.stockValue, 0)),
    moneyStuckIsEstimate: stuck.some((r) => r.costIsEstimate),
    productCount: scored.length,
    /** Every status except healthy and new asks the merchant to do something. */
    needsAttention: scored.filter((r) => r.status !== "healthy" && r.status !== "new").length,
    moneyAtStakeTotal: round2(scored.reduce((sum, r) => sum + r.moneyAtStake, 0)),
    overLimit: rows.filter((r) => r.status === "over_limit").length,
    byStatus,
    top,
  };
}

/** Where "money stuck in stock" sits: dead stock vs slow movers (products, stock value, dead stock's share of it). */
export function stuckSplit(byStatus) {
  const get = (status) => byStatus.find((s) => s.status === status) ?? { count: 0, stockValue: 0 };
  const dead = get("dead_stock");
  const slow = get("slow_mover");
  const value = dead.stockValue + slow.stockValue;
  return { products: dead.count + slow.count, value: round2(value), deadShare: value > 0 ? dead.stockValue / value : 0 };
}


