// Rescue plan measurement — docs/PLAN.md → "Measurement window (rescue plan)". Pure (no imports) so
// node:test can load it.
//
// The window starts on the day a fix is applied and ends at 150 view sessions or 30 days, whichever
// comes first, never before 14 days. The baseline is the same number of days just before the fix,
// scaled by the change in store-wide traffic (removes seasonality and ad bursts). Verdict: improved if
// conversion rises 20%+ and units rise; worse if conversion falls 20%+; otherwise no change. Under 50
// view sessions it's "not enough data" and the window is extended once.
//
// Without view data (before views are synced) conversion can't be measured: units are compared
// instead, against the baseline scaled by store-wide units, with the same ±20% bands.

import { daysBetween, round2, shiftDate } from "./dates.js";

export const WINDOW = { minDays: 14, maxDays: 30, targetViews: 150, minViews: 50, change: 0.2 };

/**
 * Store-traffic scaling is only trusted with enough volume in the rest of the store, and is kept
 * within bounds so a small store's swings can't flip a verdict on their own.
 */
export const TRAFFIC = { minUnits: 30, minViews: 300, minRatio: 0.5, maxRatio: 2 };

/** Changes are compared at 6 decimals, so exactly 20% counts as "20%+" despite floating point. */
const round6 = (n) => Math.round(n * 1e6) / 1e6;

function totals(rows, from, toExclusive) {
  const inRange = rows.filter((r) => r.date >= from && r.date < toExclusive);
  const units = inRange.reduce((s, r) => s + r.units, 0);
  const views = inRange.reduce((s, r) => s + r.views, 0);
  const purchases = inRange.reduce((s, r) => s + r.purchases, 0);
  return { days: Math.max(0, daysBetween(from, toExclusive)), units, views, purchases, conversion: views > 0 ? purchases / views : null };
}

function storeSum(rows, from, toExclusive, key) {
  return rows.filter((r) => r.date >= from && r.date < toExclusive).reduce((s, r) => s + r[key], 0);
}

/**
 * Evaluates a rescue window that started on `start` (local date of the fix), as of `today` (only
 * complete days, i.e. before today, count). `extended`: the window was already extended once.
 * `baselineEnd`: where the baseline stops (the first fix's day, if later fixes restarted the window).
 */
export function evaluateWindow({
  start,
  today,
  product,
  store,
  extended,
  historyFrom,
  baselineEnd = start,
}) {
  const maxDays = WINDOW.maxDays * (extended ? 2 : 1);
  const available = Math.max(0, Math.min(daysBetween(start, today), maxDays));
  const hasViews = store.some((d) => d.views > 0);

  // The window closes on the first day (from day 14) with 150 views, or at the max: decided by the
  // data, not by when this runs.
  let end = null;
  let views = 0;
  for (let d = 1; d <= available; d++) {
    views += totals(product, shiftDate(start, d - 1), shiftDate(start, d)).views;
    if (d >= WINDOW.minDays && ((hasViews && views >= WINDOW.targetViews) || d >= maxDays)) {
      end = d;
      break;
    }
  }
  if (end == null) return { status: "measuring", daysDone: available, viewsSoFar: totals(product, start, shiftDate(start, available)).views };

  const endDate = shiftDate(start, end);
  const after = totals(product, start, endDate);
  if (hasViews && after.views < WINDOW.minViews && !extended) return { status: "extend" };

  const wantedFrom = shiftDate(baselineEnd, -end);
  const baseStart = wantedFrom < historyFrom ? historyFrom : wantedFrom;
  const baselineRaw = totals(product, baseStart, baselineEnd);
  // A shorter known baseline is scaled up to the window's length (rates are unaffected).
  const scale = baselineRaw.days > 0 ? end / baselineRaw.days : 0;
  const baseline = {
    ...baselineRaw,
    days: end,
    units: baselineRaw.units * scale,
    views: baselineRaw.views * scale,
    purchases: baselineRaw.purchases * scale,
  };

  const basis = hasViews ? "conversion" : "units";
  const key = hasViews ? "views" : "units";
  // The rest of the store (this product left out), per day, before vs during.
  const restBefore = baselineRaw.days > 0 ? storeSum(store, baseStart, baselineEnd, key) - (key === "views" ? baselineRaw.views : baselineRaw.units) : 0;
  const restAfter = storeSum(store, start, endDate, key) - (key === "views" ? after.views : after.units);
  const minVolume = key === "views" ? TRAFFIC.minViews : TRAFFIC.minUnits;
  const rawRatio = restBefore >= minVolume && restAfter >= minVolume ? restAfter / end / (restBefore / baselineRaw.days) : 1;
  const trafficRatio = Math.min(TRAFFIC.maxRatio, Math.max(TRAFFIC.minRatio, rawRatio));
  const expectedUnits = baseline.units * trafficRatio;

  const unitsChange = expectedUnits > 0 ? round6(after.units / expectedUnits - 1) : after.units > 0 ? Infinity : null;
  const conversionChange =
    after.conversion != null && baseline.conversion != null && baseline.conversion > 0 ? round6(after.conversion / baseline.conversion - 1) : null;

  let verdict;
  if (baselineRaw.days < 7) verdict = "not_enough_data";
  else if (hasViews && (after.views < WINDOW.minViews || baseline.views === 0)) verdict = "not_enough_data";
  else if (!hasViews && expectedUnits === 0 && after.units === 0) verdict = "not_enough_data";
  else if (basis === "conversion") {
    if (conversionChange == null) {
      // No purchases before: any sales now with more units than expected is an improvement.
      verdict = after.purchases > 0 && (unitsChange ?? 0) > 0 ? "improved" : "no_change";
    } else if (conversionChange >= WINDOW.change && (unitsChange ?? 0) > 0) verdict = "improved";
    else if (conversionChange <= -WINDOW.change) verdict = "worse";
    else verdict = "no_change";
  } else {
    if ((unitsChange ?? 0) >= WINDOW.change) verdict = "improved";
    else if (unitsChange != null && unitsChange <= -WINDOW.change) verdict = "worse";
    else verdict = "no_change";
  }

  return {
    status: "done",
    verdict,
    basis,
    window: { from: start, to: shiftDate(endDate, -1) },
    baselineWindow: { from: baseStart, to: shiftDate(baselineEnd, -1) },
    after,
    baseline: { ...baseline, units: round2(baseline.units), views: round2(baseline.views), purchases: round2(baseline.purchases) },
    baselineRaw,
    trafficRatio: round2(trafficRatio),
    expectedUnits: round2(expectedUnits),
    conversionChange,
    unitsChange: unitsChange === Infinity ? null : unitsChange,
  };
}
