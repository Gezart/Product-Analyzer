// Weekly plan: each Monday, the 3–5 things most worth doing this week, by money at stake. Pure (no
// imports) so node:test can load it.

export const MAX_ACTIONS = 5;
/** Places kept for stock-out risks (no money at stake, but they can't wait). */
const STOCKOUT_PLACES = 2;

/**
 * The action for one product, or null when there's nothing to do this week (being measured, on a
 * markdown, or healthy). `p`: `{ productId, title, status, moneyAtStake, daysOfCover, markdownReason,
 * topReason, measuring, markdownRunning }` (`topReason`: the latest diagnosis's first reason, `{ code,
 * label }`; `markdownReason`: why a markdown is due, or null).
 */
export function actionFor(p) {
  if (p.measuring || p.markdownRunning) return null;
  const at = (hash) => `/products/${p.productId}${hash}`;
  if (p.status === "stockout_risk") {
    const days = p.daysOfCover == null ? null : Math.max(0, Math.round(p.daysOfCover));
    return { kind: "reorder", text: days == null ? "Reorder before it sells out." : `Reorder: about ${days} day${days === 1 ? "" : "s"} of stock left.`, href: at("#variants") };
  }
  if (p.markdownReason) return { kind: "markdown", text: `Start the markdown. ${p.markdownReason}`, href: at("") };
  if (p.topReason && ["dead_stock", "slow_mover", "page_problem", "hidden_gem"].includes(p.status)) {
    return { kind: "fix_page", text: `Fix the page: ${p.topReason.label.toLowerCase()}.`, href: at("#page") };
  }
  if (p.status === "hidden_gem") return { kind: "visibility", text: "Give it a better place in its collections: it sells well to the few who see it.", href: "/collections" };
  if (["dead_stock", "slow_mover", "page_problem"].includes(p.status)) return { kind: "diagnose", text: "Run a diagnosis to see what holds it back.", href: at("#page") };
  return null;
}

/**
 * This week's actions: products with money at stake first (most first), then stock-out risks (fewest
 * days left first) keeping up to 2 places; at most 5. Each: `{ productId, title, status, moneyAtStake,
 * kind, text, href }`.
 */
export function pickActions(candidates, max = MAX_ACTIONS) {
  const withAction = candidates.map((p) => ({ p, action: actionFor(p) })).filter((x) => x.action);
  const stockouts = withAction.filter((x) => x.action.kind === "reorder").sort((a, b) => (a.p.daysOfCover ?? 0) - (b.p.daysOfCover ?? 0));
  const others = withAction.filter((x) => x.action.kind !== "reorder" && x.p.moneyAtStake > 0).sort((a, b) => b.p.moneyAtStake - a.p.moneyAtStake);
  const keep = Math.min(STOCKOUT_PLACES, stockouts.length);
  const picked = [...others.slice(0, max - keep), ...stockouts].slice(0, max);
  return picked.map(({ p, action }) => ({ productId: p.productId, title: p.title, status: p.status, moneyAtStake: p.moneyAtStake, ...action }));
}

/** The Monday of the week a local date (`YYYY-MM-DD`) falls in. */
export function weekOf(dayKey) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday → 0 … Sunday → 6
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}
