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
