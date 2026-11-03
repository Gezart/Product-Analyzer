// Weekly plan: each Monday, the 3–5 things most worth doing this week, by money at stake. Pure (no
// imports) so node:test can load it.

export const MAX_ACTIONS = 5;
/** Places kept for stock-out risks (no money at stake, but they can't wait). */
const STOCKOUT_PLACES = 2;

/**
 * The action for one product, or null when there's nothing to do this week (being measured, on a
 * markdown, healthy, or diagnosed with nothing found). `p`: `{ productId, title, status, moneyAtStake,
 * daysOfCover, markdownReason, diagnosed, topReason, measuring, markdownRunning }` (`topReason`: the
 * latest diagnosis's first reason, `{ code, label, link }`; `markdownReason`: why a markdown is due, or null).
 */
export function actionFor(p) {
  if (p.measuring || p.markdownRunning) return null;
  const at = (hash) => `/products/${p.productId}${hash}`;
  if (p.status === "stockout_risk") {
    const days = p.daysOfCover == null ? null : Math.max(0, Math.round(p.daysOfCover));
    return { kind: "reorder", text: days == null ? "Reorder before it sells out." : `Reorder: about ${days} day${days === 1 ? "" : "s"} of stock left.`, href: at("#variants") };
  }
  if (p.markdownReason) return { kind: "markdown", text: `Start the markdown. ${p.markdownReason}`, href: at("") };
  // A hidden gem sells to whoever sees it: more eyes first, whatever its page says.
  if (p.status === "hidden_gem") return { kind: "visibility", text: "Give it a better place in its collections: it sells well to the few who see it.", href: "/collections" };
  if (!["dead_stock", "slow_mover", "page_problem"].includes(p.status)) return null;
  if (p.topReason) {
    const link = /^#[a-z-]+$/.test(p.topReason.link ?? "") ? p.topReason.link : "#diagnosis";
    return { kind: "fix_page", text: `What holds it back: ${p.topReason.label.toLowerCase()}.`, href: at(link) };
  }
  // Diagnosed and nothing found: no action to suggest here (its other signs are on the product page).
  if (p.diagnosed) return null;
  return { kind: "diagnose", text: "Run a diagnosis to see what holds it back.", href: at("#diagnosis") };
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

/** Last week (Monday to Sunday) for a plan's week (its Monday): `{ from, to }`. */
export function lastWeekOf(week) {
  const monday = new Date(`${week}T00:00:00Z`).getTime();
  const day = (offset) => new Date(monday + offset * 86_400_000).toISOString().slice(0, 10);
  return { from: day(-7), to: day(-1) };
}

const VERDICT_ORDER = ["improved", "worse", "no_change", "not_enough_data"];

/**
 * A rescue verdict for the recap: extra units over what was expected (improved ones only, never below
 * 0) and those units at the product's price. `plan`: `{ productId, title, price, verdict, result }`.
 */
export function verdictLine(plan) {
  const r = plan.result ?? {};
  const extraUnits = plan.verdict === "improved" && r.after?.units != null && r.expectedUnits != null ? Math.max(0, Math.round(r.after.units - r.expectedUnits)) : null;
  return {
    productId: plan.productId,
    title: plan.title,
    verdict: plan.verdict,
    // Which window it was (a later plan doesn't report it twice).
    windowTo: r.window?.to ?? null,
    extraUnits,
    extraSales: extraUnits == null ? null : Math.round(extraUnits * (plan.price ?? 0) * 100) / 100,
  };
}

/**
 * Last week's results: rescue verdicts (improved first) with the extra sales of the improved ones, and
 * markdowns started and ended. `null` when nothing happened.
 */
export function recapOf({ verdicts = [], started = [], ended = [] }) {
  if (!verdicts.length && !started.length && !ended.length) return null;
  const lines = verdicts.map(verdictLine).sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || (b.extraSales ?? 0) - (a.extraSales ?? 0));
  return {
    verdicts: lines,
    extraSales: Math.round(lines.reduce((s, l) => s + (l.extraSales ?? 0), 0) * 100) / 100,
    markdownsStarted: started,
    markdownsEnded: ended,
  };
}

/**
 * Whether a rescue verdict belongs in a plan's "last week": its window ended last week (`from`–`to`),
 * or ended since `earliest` and no earlier plan reported it (`reported`: keys `productId:windowTo`).
 */
export function verdictCounts(productId, windowTo, { from, to, earliest, reported }) {
  if (typeof windowTo !== "string" || windowTo > to) return false;
  if (windowTo >= from) return true;
  return windowTo >= earliest && !reported.has(`${productId}:${windowTo}`);
}
