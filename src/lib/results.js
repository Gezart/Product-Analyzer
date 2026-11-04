// The Results page (the owner's design): each rescue plan as a row (what changed, its window, conversion
// before and now, verdict, what's next) and the counts on top. Pure (relative imports only) so
// node:test can load it.

import { CHANGED } from "./product-list.js";
import { WINDOW } from "./rescue.js";
import { verdictLine } from "./weekly-plan.js";

const DAY_MS = 86_400_000;
const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const shortDay = (key, locale) => new Date(`${key}T00:00:00Z`).toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" });
const conv = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.round(Math.abs(n) * 100)}%`;

export const VERDICTS = {
  measuring: { label: "Measuring", tone: "info" },
  improved: { label: "Improved", tone: "good" },
  no_change: { label: "No change", tone: "neutral" },
  worse: { label: "Worse", tone: "bad" },
  not_enough_data: { label: "Not enough data", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** The day a plan's window ended (its result's last day, else its end), or null while it measures. */
export const endedOn = (plan) => (plan.verdict ? (plan.result?.window?.to ?? plan.endsAt ?? null) : null);

/**
 * One rescue plan as a row. `plan`: `{ productId, title, price, startedAt (YYYY-MM-DD), endsAt, verdict,
 * result, fixTypes, extended, viewsSoFar }`; `today` the store's day; `money` formats the store's currency.
 * Returns `{ change, started, progress (0–1), window, conversion, verdict: { label, tone }, next }` with
 * `next`: `{ cta, href }`, `{ note }` or null.
 */
export function resultRow(plan, { today, money, locale } = {}) {
  const types = [...new Set(plan.fixTypes ?? [])];
  const change = types.length ? types.map((t) => CHANGED[t] ?? "Changed").join(", ") : "Changes";
  const started = shortDay(plan.startedAt, locale);
  const r = plan.result;
  const verdict = VERDICTS[plan.verdict ?? "measuring"] ?? { label: plan.verdict, tone: "neutral" };

  let progress;
  let window;
  if (!plan.verdict) {
    const day = Math.max(1, days(plan.startedAt, today) + 1);
    const maxDays = WINDOW.maxDays * (plan.extended ? 2 : 1);
    const views = plan.viewsSoFar ?? 0;
    // It ends at the target views or the longest window, whichever comes first, never before 14 days.
    progress = Math.min(1, Math.max(day / maxDays, views > 0 ? Math.min(views / WINDOW.targetViews, 1) * Math.min(1, day / WINDOW.minDays) : 0));
    window = views > 0 ? `Day ${day} · ${views.toLocaleString()} of ${WINDOW.targetViews} visits` : `Day ${day} of ${WINDOW.minDays}–${maxDays}`;
  } else {
    const end = endedOn(plan);
    progress = 1;
    window = end ? `Finished ${shortDay(end, locale)} · ${days(plan.startedAt, end) + 1} days` : "Finished";
  }

  let conversion = "—";
  if (r?.basis === "conversion") {
    conversion = `${conv(r.baseline?.conversion)} → ${conv(r.after?.conversion)}${r.conversionChange != null && Number.isFinite(r.conversionChange) ? ` · ${signed(r.conversionChange)}` : ""}`;
  } else if (r?.basis === "units") {
    // Without visit data, units are compared: the units expected (store-adjusted) against those sold.
    conversion = `${Math.round(r.expectedUnits ?? r.baseline?.units ?? 0)} expected → ${r.after?.units ?? 0} sold${r.unitsChange != null && Number.isFinite(r.unitsChange) ? ` · ${signed(r.unitsChange)}` : ""}`;
  }

  let next = null;
  if (plan.verdict === "worse" && types.length) next = { cta: types.every((t) => t === "position") ? "Undo the order" : "Undo the change", href: `/products/${plan.productId}#rescue` };
  else if (plan.verdict === "no_change") next = { cta: "Start markdown", href: `/products/${plan.productId}/markdown` };
  else if (plan.verdict === "improved") {
    const { extraSales } = verdictLine(plan);
    if (extraSales > 0 && money) next = { note: `+${money.format(extraSales)} recovered` };
  }
  return { change, started, progress, window, conversion, verdict, next };
}

/** The counts on top: measuring now, and the verdicts of windows that ended in the last 90 days. */
export function resultSummary(plans, today) {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * DAY_MS).toISOString().slice(0, 10);
  const recent = (verdict) => plans.filter((p) => p.verdict === verdict && (endedOn(p) ?? "") >= since).length;
  return { measuring: plans.filter((p) => !p.verdict).length, improved: recent("improved"), noChange: recent("no_change"), worse: recent("worse") };
}
