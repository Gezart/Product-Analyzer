// Rising stars: what to do with a product whose sales are taking off. Pure (no imports).

/** Below this many days of stock at the current pace, a rising star should be reordered. */
export const REORDER_BELOW_DAYS = 45;

/** "+35%" for a trend of 1.35 (sales over the 30 days before). */
export const growthLabel = (trend) => (trend == null ? "" : `+${Math.round((trend - 1) * 100)}%`);

/**
 * The suggested actions for a rising star: more visibility in its collections and on the home page,
 * and stock when it would run out within 45 days at this pace. Each: `{ kind, text, href }`.
 */
export function risingActions({ daysOfCover }) {
  const actions = [
    { kind: "collections", text: "Move it up in its collections, where shoppers look first.", href: "/collections" },
    { kind: "home", text: "Feature it on your home page (in the theme editor).", href: "shopify:admin/themes" },
  ];
  if (daysOfCover != null && daysOfCover < REORDER_BELOW_DAYS) {
    const days = Math.max(0, Math.round(daysOfCover));
    actions.unshift({ kind: "stock", text: `Reorder: about ${days} day${days === 1 ? "" : "s"} of stock left at this pace, and the pace is rising.`, href: "#variants" });
  }
  return actions;
}

/** What a rising star's action is called. */
export const ACTION_LABELS = { collections: "Moved up in its collections", home: "Featured on the home page", stock: "Restocked" };
/** Measured for this long after the action; a result shows from day 7. */
export const EFFECT_DAYS = 30;
export const EFFECT_MIN_DAYS = 7;

const dayMs = 86_400_000;
const shift = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);

/**
 * An action's effect: units per day since it (complete days, up to 30) against the 30 days before.
 * `rows`: `{ date: "YYYY-MM-DD", units }`; `startedOn` and `today` are the store's days. Returns
 * `{ days, before, after, change, done }` (`change` null when there were no sales before, or under 7 days).
 */
export function actionEffect(rows, startedOn, today) {
  const end = shift(startedOn, EFFECT_DAYS) < today ? shift(startedOn, EFFECT_DAYS) : today; // exclusive
  const days = Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`)) / dayMs));
  const from = shift(startedOn, -EFFECT_DAYS);
  let unitsBefore = 0;
  let unitsAfter = 0;
  for (const r of rows) {
    if (r.date >= from && r.date < startedOn) unitsBefore += r.units;
    else if (r.date >= startedOn && r.date < end) unitsAfter += r.units;
  }
  const before = unitsBefore / EFFECT_DAYS;
  const after = days > 0 ? unitsAfter / days : 0;
  const round = (n) => Math.round(n * 100) / 100;
  return {
    days,
    before: round(before),
    after: round(after),
    change: days >= EFFECT_MIN_DAYS && before > 0 ? round(after / before - 1) : null,
    done: days >= EFFECT_DAYS,
  };
}
