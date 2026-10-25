// Shared UI helpers for statuses and money.

// Labels and next actions from docs/PLAN.md → Product statuses.
export const STATUS_INFO = {
  dead_stock: { label: "Dead stock", action: "Fix the page, or clear it with a markdown", tone: "critical" },
  slow_mover: { label: "Slow mover", action: "Diagnose, then rescue plan", tone: "warning" },
  page_problem: { label: "Page problem", action: "Fix the product page", tone: "warning" },
  hidden_gem: { label: "Hidden gem", action: "Raise visibility", tone: "info" },
  stockout_risk: { label: "Stock-out risk", action: "Reorder", tone: "attention" },
  healthy: { label: "Healthy", action: "Nothing to do", tone: "success" },
  new: { label: "New", action: "Too early to judge; it's analyzed fully after 30 days", tone: "info" },
  excluded: { label: "Not analyzed", action: "Draft, archived or excluded in Settings", tone: "neutral" },
  unscored: { label: "Not analyzed yet", action: "Analyzed at the next nightly run", tone: "neutral" },
  over_limit: { label: "Over plan limit", action: "Upgrade your plan to analyze it", tone: "neutral" },
};

/** Days of stock for people: "—" when unknown, "over a year" past 365, otherwise a whole number. */
export function formatDays(days) {
  if (days == null) return "—";
  if (days > 365) return "over a year";
  return Math.round(days).toLocaleString();
}

/** Store-currency formatter; a missing or unknown currency code falls back to plain numbers. */
export function moneyFormatter(currency, maximumFractionDigits = 0) {
  try {
    if (currency) return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits });
  } catch {}
  return new Intl.NumberFormat(undefined, { maximumFractionDigits });
}
