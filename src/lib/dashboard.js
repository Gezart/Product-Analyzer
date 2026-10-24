export const STATUS_ORDER = ["dead_stock", "slow_mover", "page_problem", "hidden_gem", "stockout_risk", "healthy"];

/** Statuses whose stock counts as "money stuck in stock". */
const STUCK = new Set(["dead_stock", "slow_mover"]);

export function summarize(rows, topN = 10) {
  const scored = rows.filter((r) => (STATUS_ORDER).includes(r.status));
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
  const top = scored
    .filter((r) => r.moneyAtStake > 0 || r.status === "stockout_risk")
    .sort((a, b) => priority(b) - priority(a))
    .slice(0, topN);
  return {
    moneyStuck: round2(stuck.reduce((sum, r) => sum + r.stockValue, 0)),
    moneyStuckIsEstimate: stuck.some((r) => r.costIsEstimate),
    productCount: scored.length,
    byStatus,
    top,
  };
}

/**
 * Action list order: money at stake first. Stock-out risks carry no money at stake but need a
 * reorder soon, so they rank by how few days of stock are left, below any product with money at stake.
 */
function priority(r) {
  if (r.moneyAtStake > 0) return 1_000_000_000 + r.moneyAtStake;
  return 1 / (1 + (r.daysOfCover ?? 0));
}

const round2 = (n) => Math.round(n * 100) / 100;
