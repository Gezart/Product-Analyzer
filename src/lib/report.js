// Monthly report — docs/PLAN.md module 8 and "Revenue recovered". Pure (no imports) so node:test can load it.
//
// Revenue recovered = actual revenue during a rescue or markdown period − baseline daily revenue ×
// days in the period, floored at 0 (per product and period, for the days inside the month).
// Rescue periods: measurement windows of rescue plans that improved. Markdown periods: from the
// day a markdown plan's first step went live until it ended (or until yesterday while it runs).

const DAY_MS = 86_400_000;
const round2 = (n) => Math.round(n * 100) / 100;
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** First and last day of a "YYYY-MM" month, or null for anything else. */
export function monthRange(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? "")) return null;
  const [y, m] = period.split("-").map(Number);
  return { from: `${period}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

/** The month before `today` ("YYYY-MM-DD" → "YYYY-MM"). */
export function previousMonth(today) {
  return shift(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
}

/** Baseline daily revenue: revenue over `from`..`to` (inclusive) ÷ its days; 0 for an empty range. */
export function dailyBaseline(rows, from, to) {
  const days = daysBetween(from, to) + 1;
  if (days <= 0) return 0;
  return rows.filter((r) => r.date >= from && r.date <= to).reduce((s, r) => s + r.revenue, 0) / days;
}

/**
 * The month's numbers. `periods`: { productId, title, kind: "rescue" | "markdown", from, to (inclusive),
 * baselineDaily }; `daily`: productId → [{ date, units, revenue }]; `unitCost`: productId → cost or null.
 * Only complete days count (before `today`). A day already counted for a product isn't counted again.
 */
export function monthlyReport({ period, today, periods, daily, unitCost, rescued, fixes }) {
  const month = monthRange(period);
  const last = [month.to, shift(today, -1)].sort()[0];
  const counted = new Map();
  const rows = [];
  for (const p of [...periods].sort((a, b) => a.from.localeCompare(b.from))) {
    const from = [p.from, month.from].sort()[1];
    const to = [p.to, last].sort()[0];
    if (from > to) continue;
    const seen = counted.get(p.productId) ?? new Set();
    counted.set(p.productId, seen);
    let days = 0;
    let actual = 0;
    let units = 0;
    const byDate = new Map((daily.get(p.productId) ?? []).map((r) => [r.date, r]));
    for (let d = from; d <= to; d = shift(d, 1)) {
      if (seen.has(d)) continue;
      seen.add(d);
      days++;
      actual += byDate.get(d)?.revenue ?? 0;
      units += byDate.get(d)?.units ?? 0;
    }
    if (days === 0) continue;
    const expected = p.baselineDaily * days;
    // Unit cost unknown: 50% of the average price these units sold at (as for stock value elsewhere).
    const cost = unitCost.get(p.productId);
    const costEach = cost ?? (units > 0 ? (actual / units) * 0.5 : 0);
    rows.push({
      productId: p.productId,
      title: p.title,
      kind: p.kind,
      from,
      to,
      days,
      actual: round2(actual),
      baselineDaily: round2(p.baselineDaily),
      expected: round2(expected),
      recovered: round2(Math.max(0, actual - expected)),
      units,
      unitCost: round2(costEach),
      costIsEstimate: cost == null && units > 0,
      stockValueCleared: round2(units * costEach),
    });
  }
  const inMonth = (date) => date >= month.from && date <= month.to;
  return {
    period,
    from: month.from,
    to: last,
    complete: last === month.to,
    revenueRecovered: round2(rows.reduce((s, r) => s + r.recovered, 0)),
    stockValueCleared: round2(rows.reduce((s, r) => s + r.stockValueCleared, 0)),
    stockValueIsEstimate: rows.some((r) => r.costIsEstimate),
    productsRescued: rescued.filter((r) => inMonth(r.windowEnd)).length,
    rescued: rescued.filter((r) => inMonth(r.windowEnd)),
    rows,
    fixes: fixes.filter((f) => inMonth(f.appliedOn)),
  };
}
