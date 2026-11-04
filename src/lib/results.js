// The Results page (the owner's design): each rescue plan as a row (what changed, its window, conversion
// before and now, verdict, what's next). Pure (relative imports only) so node:test can load it.

import { CHANGED } from "./product-list.js";
import { WINDOW } from "./rescue.js";
import { verdictLine } from "./weekly-plan.js";

const DAY_MS = 86_400_000;
const LOCALE = "en-US";
const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const shift = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const shortDay = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString(LOCALE, { month: "short", day: "numeric", timeZone: "UTC" });
const conv = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.round(Math.abs(n) * 100)}%`;

export const VERDICTS = {
  measuring: { label: "Measuring", tone: "rising" },
  improved: { label: "Improved", tone: "good" },
  no_change: { label: "No change", tone: "neutral" },
  worse: { label: "Worse", tone: "bad" },
  not_enough_data: { label: "Not enough data", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/**
 * A measuring plan so far: its complete days (`start` to yesterday), visits and purchases, and as many
 * days just before the change (before `baselineEnd`, as the verdict's baseline). `rows`: `{ date, views,
 * purchases }` of the product, days before `today`.
 */
export function liveTotals(rows, { start, baselineEnd, today }) {
  const daysSoFar = Math.max(0, days(start, today));
  const sum = (from, to, key) => rows.filter((r) => r.date >= from && r.date < to).reduce((n, r) => n + (r[key] ?? 0), 0);
  const beforeFrom = shift(baselineEnd, -Math.max(1, daysSoFar));
  return {
    days: daysSoFar,
    views: sum(start, today, "views"),
    purchases: sum(start, today, "purchases"),
    beforeViews: sum(beforeFrom, baselineEnd, "views"),
    beforePurchases: sum(beforeFrom, baselineEnd, "purchases"),
  };
}

/**
 * One rescue plan as a row. `plan`: `{ productId, title, price, startedAt (YYYY-MM-DD), endsAt, verdict,
 * result, fixTypes, extended, live, undoable, markdownable }`; `today` the store's day; `money` formats the
 * store's currency. Returns `{ change, started, progress (0–1), window, conversion, verdict, next }` with
 * `next`: `{ cta, href }`, `{ note }` or null.
 */
export function resultRow(plan, { today, money } = {}) {
  const types = [...new Set(plan.fixTypes ?? [])];
  const cancelled = plan.verdict === "cancelled";
  const change = types.length ? types.map((t) => CHANGED[t] ?? "Changed").join(", ") : cancelled ? "All changes undone" : "Changes";
  const started = shortDay(plan.startedAt);
  const r = plan.result;
  const verdict = VERDICTS[plan.verdict ?? "measuring"] ?? { label: plan.verdict, tone: "neutral" };

  let progress;
  let window;
  let conversion = "—";
  if (!plan.verdict) {
    const live = plan.live ?? { days: 0, views: 0, purchases: 0, beforeViews: 0, beforePurchases: 0 };
    const day = Math.max(1, days(plan.startedAt, today) + 1);
    const maxDays = WINDOW.maxDays * (plan.extended ? 2 : 1);
    // Without visits (before or since), sales are compared and the window runs its full length.
    const hasViews = live.views > 0 || live.beforeViews > 0;
    if (!hasViews) {
      progress = Math.min(1, day / maxDays);
      window = `Day ${day} of ${maxDays} · sales compared`;
    } else if (live.views >= WINDOW.targetViews) {
      // The target is reached: it ends now, or on day 14 at the earliest.
      progress = Math.min(1, Math.max(day / WINDOW.minDays, day / maxDays));
      window = day < WINDOW.minDays ? `Day ${day} · ${WINDOW.targetViews} visits reached, ends on day ${WINDOW.minDays}` : `Day ${day} · ${WINDOW.targetViews} visits reached`;
    } else {
      progress = Math.min(1, Math.max(day / maxDays, live.views / WINDOW.targetViews));
      window = `Day ${day} · ${live.views.toLocaleString(LOCALE)} of ${WINDOW.targetViews} visits`;
    }
    // So far, unadjusted: the verdict at the end scales the baseline by the store's traffic.
    if (hasViews && live.views > 0) {
      const before = live.beforeViews > 0 ? live.beforePurchases / live.beforeViews : null;
      conversion = `${conv(before)} → ${conv(live.purchases / live.views)} so far`;
    }
  } else if (cancelled) {
    progress = 0;
    window = "Stopped: every change was undone";
  } else {
    const end = r?.window?.to ?? (plan.endsAt ? shift(plan.endsAt, -1) : null);
    progress = 1;
    window = end ? `Finished ${shortDay(end)} · ${days(plan.startedAt, end) + 1} days` : "Finished";
  }

  if (r?.basis === "conversion") {
    conversion = `${conv(r.baseline?.conversion)} → ${conv(r.after?.conversion)}${r.conversionChange != null && Number.isFinite(r.conversionChange) ? ` · ${signed(r.conversionChange)}` : ""}`;
  } else if (r?.basis === "units") {
    // Without visit data, units are compared: the units expected (store-adjusted) against those sold.
    conversion = `${Math.round(r.expectedUnits ?? r.baseline?.units ?? 0)} expected → ${r.after?.units ?? 0} sold${r.unitsChange != null && Number.isFinite(r.unitsChange) ? ` · ${signed(r.unitsChange)}` : ""}`;
  }

  let next = null;
  if (plan.verdict === "worse" && plan.undoable) next = { cta: types.every((t) => t === "position") ? "Undo the order" : "Undo the change", href: `/products/${plan.productId}#rescue` };
  else if (plan.verdict === "no_change" && plan.markdownable) next = { cta: "Start markdown", href: `/products/${plan.productId}/markdown` };
  else if (plan.verdict === "improved") {
    // Units sold above what was expected, at the product's price (as in the weekly plan's recap).
    const { extraSales } = verdictLine(plan);
    if (extraSales > 0 && money) next = { note: `+${money.format(extraSales)} extra sales` };
  }
  return { change, started, progress, window, conversion, verdict, next };
}
