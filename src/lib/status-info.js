// Shared UI helpers for statuses and money.

// Labels and next actions from docs/PLAN.md → Product statuses.
export const STATUS_INFO = {
  dead_stock: { label: "Dead stock", action: "Short rescue plan, then markdown", tone: "critical" },
  slow_mover: { label: "Slow mover", action: "Diagnose, then rescue plan", tone: "warning" },
  page_problem: { label: "Page problem", action: "Fix the product page", tone: "warning" },
  hidden_gem: { label: "Hidden gem", action: "Raise visibility", tone: "info" },
  stockout_risk: { label: "Stock-out risk", action: "Reorder", tone: "attention" },
  healthy: { label: "Healthy", action: "Nothing to do", tone: "success" },
  excluded: { label: "Not analyzed", action: "Draft, archived or excluded in Settings", tone: "neutral" },
};

/** Store-currency formatter; a missing or unknown currency code falls back to plain numbers. */
export function moneyFormatter(currency, maximumFractionDigits = 0) {
  try {
    if (currency) return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits });
  } catch {}
  return new Intl.NumberFormat(undefined, { maximumFractionDigits });
}
