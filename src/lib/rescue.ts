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

export const WINDOW = { minDays: 14, maxDays: 30, targetViews: 150, minViews: 50, change: 0.2 };

export type Day = { date: string; units: number; views: number; purchases: number };
export type StoreDay = { date: string; units: number; views: number };
export type Verdict = "improved" | "no_change" | "worse" | "not_enough_data";

export type Totals = { days: number; units: number; views: number; purchases: number; conversion: number | null };

export type Evaluation =
  | { status: "measuring"; daysDone: number; viewsSoFar: number }
  | {
      status: "done";
      verdict: Verdict;
      basis: "conversion" | "units";
      window: { from: string; to: string };
      baselineWindow: { from: string; to: string };
      after: Totals;
      baseline: Totals;
      /** Store-wide traffic now ÷ before (views, or units without view data); scales the baseline. */
      trafficRatio: number;
      /** Baseline units scaled by `trafficRatio`. */
      expectedUnits: number;
      conversionChange: number | null;
      unitsChange: number | null;
    }
  | { status: "extend" };

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

function totals(rows: Day[], from: string, toExclusive: string): Totals {
  const inRange = rows.filter((r) => r.date >= from && r.date < toExclusive);
  const units = inRange.reduce((s, r) => s + r.units, 0);
  const views = inRange.reduce((s, r) => s + r.views, 0);
  const purchases = inRange.reduce((s, r) => s + r.purchases, 0);
  return { days: daysBetween(from, toExclusive), units, views, purchases, conversion: views > 0 ? purchases / views : null };
}

function storeSum(rows: StoreDay[], from: string, toExclusive: string, key: "units" | "views") {
  return rows.filter((r) => r.date >= from && r.date < toExclusive).reduce((s, r) => s + r[key], 0);
}

/**
 * Evaluates a rescue window that started on `start` (local date of the fix), as of `today` (only
 * complete days, i.e. before today, count). `extended`: the window was already extended once.
 */
export function evaluateWindow({
  start,
  today,
  product,
  store,
  extended,
  historyFrom,
}: {
  start: string;
  today: string;
  product: Day[];
  store: StoreDay[];
  extended: boolean;
  /** First day with known data; the baseline doesn't reach before it (scaled to the window length). */
  historyFrom: string;
}): Evaluation {
  const maxDays = WINDOW.maxDays * (extended ? 2 : 1);
  const daysDone = Math.max(0, Math.min(daysBetween(start, today), maxDays));
  const viewsSoFar = totals(product, start, shift(start, daysDone)).views;
  const hasViews = store.some((d) => d.views > 0);

  const reachedTarget = hasViews && viewsSoFar >= WINDOW.targetViews;
  const finished = daysDone >= WINDOW.minDays && (reachedTarget || daysDone >= maxDays);
  if (!finished) return { status: "measuring", daysDone, viewsSoFar };

  const end = shift(start, daysDone);
  const baseStart = shift(start, -daysDone) < historyFrom ? historyFrom : shift(start, -daysDone);
  const after = totals(product, start, end);
  const rawBaseline = totals(product, baseStart, start);
  // A shorter known baseline is scaled up to the window's length (rates are unaffected).
  const scale = rawBaseline.days > 0 ? daysDone / rawBaseline.days : 0;
  const baseline: Totals = {
    ...rawBaseline,
    days: daysDone,
    units: rawBaseline.units * scale,
    views: rawBaseline.views * scale,
    purchases: rawBaseline.purchases * scale,
  };
  const shortBaseline = rawBaseline.days < 7;

  if (hasViews && after.views < WINDOW.minViews) {
    if (!extended && daysDone < maxDays * 2) return { status: "extend" };
  }

  const basis = hasViews ? "conversion" : "units";
  const key = hasViews ? "views" : "units";
  // Store traffic per day before vs during, so a shorter baseline compares fairly.
  const storeBefore = rawBaseline.days > 0 ? storeSum(store, baseStart, start, key) / rawBaseline.days : 0;
  const storeAfter = daysDone > 0 ? storeSum(store, start, end, key) / daysDone : 0;
  // The product's own numbers are part of the store total; leave them out so a jump in this product
  // doesn't cancel itself out.
  const ownBefore = (key === "views" ? rawBaseline.views : rawBaseline.units) / Math.max(1, rawBaseline.days);
  const ownAfter = (key === "views" ? after.views : after.units) / Math.max(1, daysDone);
  const restBefore = storeBefore - ownBefore;
  const restAfter = storeAfter - ownAfter;
  const trafficRatio = restBefore > 0 && restAfter > 0 ? restAfter / restBefore : 1;
  const expectedUnits = baseline.units * trafficRatio;

  const unitsChange = expectedUnits > 0 ? after.units / expectedUnits - 1 : after.units > 0 ? Infinity : null;
  const conversionChange =
    after.conversion != null && baseline.conversion != null && baseline.conversion > 0 ? after.conversion / baseline.conversion - 1 : null;

  let verdict: Verdict;
  if (shortBaseline) verdict = "not_enough_data";
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
    window: { from: start, to: shift(end, -1) },
    baselineWindow: { from: baseStart, to: shift(start, -1) },
    after,
    baseline: { ...baseline, units: round2(baseline.units), views: round2(baseline.views), purchases: round2(baseline.purchases) },
    trafficRatio,
    expectedUnits: Math.round(expectedUnits * 100) / 100,
    conversionChange,
    unitsChange: unitsChange === Infinity ? null : unitsChange,
  };
}
