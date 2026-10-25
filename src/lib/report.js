// Monthly report — docs/PLAN.md module 8 and "Revenue recovered". Pure (no imports) so node:test can load it.
//
// Revenue recovered = actual revenue during a rescue or markdown period − baseline daily revenue ×
// days in the period, floored at 0 (per product and period).
// Rescue periods: the measurement window of a rescue plan that improved, counted whole in the month
// the window ends (its verdict comes right after). Markdown periods: from approval until the day
// before the plan ended, counted day by day in each month. A day is counted once per product.

import { daysBetween, round2, shiftDate } from "./dates.js";

/** Markdown baseline: average daily revenue over the 30 days before the plan started. */
export const MARKDOWN_BASELINE_DAYS = 30;

/** First and last day of a "YYYY-MM" month, or null for anything else. */
export function monthRange(period) {
  if (!/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(period ?? "")) return null;
  const [y, m] = period.split("-").map(Number);
  return { from: `${period}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

/** The month before `today` ("YYYY-MM-DD" → "YYYY-MM"). */
export function previousMonth(today) {
  return shiftDate(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
}

/** Months from `first` to `last` ("YYYY-MM", inclusive), newest first. */
export function monthsBetween(first, last) {
  const out = [];
  for (let m = last; m >= first; m = previousMonth(`${m}-01`)) out.push(m);
  return out;
}

/** Baseline daily revenue over `from`..`to` (inclusive); null when there is no such range. */
export function dailyBaseline(rows, from, to) {
  const days = daysBetween(from, to) + 1;
  if (days <= 0) return null;
  return rows.filter((r) => r.date >= from && r.date <= to).reduce((s, r) => s + r.revenue, 0) / days;
}

/**
 * A markdown plan's period: from the day it started until the day before it ended (prices were
 * restored that day), or open while it runs. Baseline: the 30 days before it started, cut at the start
 * of the known history; null when none of it is known.
 */
export function markdownPeriod({ startedOn, endedOn, historyFrom }) {
  const baseFrom = [shiftDate(startedOn, -MARKDOWN_BASELINE_DAYS), historyFrom].sort()[1];
  const baseTo = shiftDate(startedOn, -1);
  return { from: startedOn, to: endedOn ? shiftDate(endedOn, -1) : null, baseline: baseFrom <= baseTo ? [baseFrom, baseTo] : null };
}

/** Average unit cost of the variants that have one (a cost of 0 counts as not set); null if none. */
export function averageCost(costs) {
  const known = costs.filter((c) => c != null && c > 0);
  return known.length ? known.reduce((s, c) => s + c, 0) / known.length : null;
}

/**
 * The month's numbers. `periods`: { productId, title, kind: "rescue" | "markdown", from, to (inclusive,
 * null = still running), baseline: [from, to] | null, baselineDaily: number | null }. Rescue periods
 * that overlap the month but end later aren't counted yet; their days are kept free of markdown rows.
 * `daily`: productId → [{ date, units, revenue }]; `unitCost`: productId → cost or null.
 * Only complete days count (before `today`).
 */
export function monthlyReport({ period, today, periods, daily, unitCost, fixes }) {
  const month = monthRange(period);
  const last = [month.to, shiftDate(today, -1)].sort()[0];
  const seen = new Map();
  const daysOf = (productId) => (seen.has(productId) ? seen.get(productId) : seen.set(productId, new Set()).get(productId));
  const rescues = periods.filter((p) => p.kind === "rescue");
  // Reserve every rescue window's days first, so a markdown day inside one is never counted twice.
  for (const p of rescues) for (let d = p.from; d <= p.to; d = shiftDate(d, 1)) daysOf(p.productId).add(`rescue:${d}`);

  const rows = [];
  const add = (p, from, to, dayList) => {
    const byDate = new Map((daily.get(p.productId) ?? []).map((r) => [r.date, r]));
    const actual = dayList.reduce((s, d) => s + (byDate.get(d)?.revenue ?? 0), 0);
    const units = dayList.reduce((s, d) => s + (byDate.get(d)?.units ?? 0), 0);
    const baselineDaily = p.baselineDaily == null ? null : round2(p.baselineDaily);
    const expected = baselineDaily == null ? null : round2(baselineDaily * dayList.length);
    // Unit cost unknown: 50% of the average price these units sold at (as for stock value elsewhere).
    const cost = unitCost.get(p.productId);
    const costEach = cost ?? (units > 0 ? (actual / units) * 0.5 : 0);
    rows.push({
      productId: p.productId,
      title: p.title,
      kind: p.kind,
      from,
      to,
      days: dayList.length,
      skippedDays: daysBetween(from, to) + 1 - dayList.length,
      baselineFrom: p.baseline?.[0] ?? null,
      baselineTo: p.baseline?.[1] ?? null,
      actual: round2(actual),
      baselineDaily,
      expected,
      // Without a known baseline nothing can be called recovered.
      recovered: expected == null ? 0 : round2(Math.max(0, actual - expected)),
      units,
      unitCost: round2(costEach),
      costIsEstimate: cost == null && units > 0,
      stockValueCleared: round2(units * costEach),
    });
  };

  for (const p of [...rescues].sort((a, b) => a.from.localeCompare(b.from))) {
    if (p.to < month.from || p.to > last) continue;
    const dayList = [];
    for (let d = p.from; d <= p.to; d = shiftDate(d, 1)) if (!daysOf(p.productId).has(d)) dayList.push(d);
    dayList.forEach((d) => daysOf(p.productId).add(d));
    if (dayList.length) add(p, p.from, p.to, dayList);
  }
  for (const p of periods.filter((x) => x.kind === "markdown").sort((a, b) => a.from.localeCompare(b.from))) {
    const from = [p.from, month.from].sort()[1];
    const to = [p.to ?? month.to, last].sort()[0];
    if (from > to) continue;
    const dayList = [];
    const own = daysOf(p.productId);
    for (let d = from; d <= to; d = shiftDate(d, 1)) if (!own.has(d) && !own.has(`rescue:${d}`)) dayList.push(d);
    dayList.forEach((d) => own.add(d));
    if (dayList.length) add(p, from, to, dayList);
  }

  return {
    period,
    from: month.from,
    to: last,
    complete: last === month.to,
    revenueRecovered: round2(rows.reduce((s, r) => s + r.recovered, 0)),
    stockValueCleared: round2(rows.reduce((s, r) => s + r.stockValueCleared, 0)),
    stockValueIsEstimate: rows.some((r) => r.costIsEstimate),
    productsRescued: new Set(rows.filter((r) => r.kind === "rescue").map((r) => r.productId)).size,
    rows,
    fixes: fixes.filter((f) => f.appliedOn >= month.from && f.appliedOn <= month.to),
  };
}
