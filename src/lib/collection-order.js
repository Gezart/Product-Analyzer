// Collection Optimizer: the order a manually sorted collection's products should have, from each
// product's status and its last 30 days of sales. Pure (no imports) so node:test can load it.

/** The groups, top to bottom, with the reason shown for each product. */
export const ORDER_GROUPS = [
  { key: "bestseller", reason: "Bestseller" },
  { key: "bestseller_low", reason: "Bestseller, running low on stock" },
  { key: "hidden_gem", reason: "Hidden gem: sells well to the few who see it" },
  { key: "needs_sales", reason: "Needs sales: stock is waiting" },
  { key: "keep", reason: "Keeps its place" },
  { key: "page_problem", reason: "Many see it, few buy: fix its page first" },
  { key: "out_of_season", reason: "Out of season" },
  { key: "sold_out", reason: "Sold out" },
  { key: "not_on_sale", reason: "Not on sale (draft or archived)" },
];
const RANK = new Map(ORDER_GROUPS.map((g, i) => [g.key, i]));
export const REASONS = Object.fromEntries(ORDER_GROUPS.map((g) => [g.key, g.reason]));

/** The top third of the collection's selling products (by 30-day revenue) are its bestsellers. */
const BESTSELLER_SHARE = 1 / 3;

/**
 * The group of each product. `items` are the collection's products in their current order:
 * `{ id, status, revenue30, moneyAtStake, available, active }` (`active`: on sale, not a draft or
 * archived; `available`: also in stock or sold when out; `status` null when the app has no score for
 * it, e.g. not analyzed on the plan).
 */
function groupsOf(items) {
  const sellers = items.filter((p) => p.available && p.revenue30 > 0).sort((a, b) => b.revenue30 - a.revenue30);
  const top = new Set(sellers.slice(0, Math.ceil(sellers.length * BESTSELLER_SHARE)).map((p) => p.id));
  return items.map((p) => {
    if (p.active === false) return "not_on_sale";
    if (!p.available) return "sold_out";
    if (p.status === "seasonal") return "out_of_season";
    if (top.has(p.id) && !["dead_stock", "slow_mover", "page_problem"].includes(p.status)) {
      return p.status === "stockout_risk" ? "bestseller_low" : "bestseller";
    }
    if (p.status === "hidden_gem") return "hidden_gem";
    if (p.status === "slow_mover" || p.status === "dead_stock") return "needs_sales";
    if (p.status === "page_problem") return "page_problem";
    return "keep";
  });
}

/**
 * The proposed order: bestsellers first (by revenue; those about to run out after them, so they don't
 * sell out sooner), then hidden gems and products that need sales (most money waiting first), then the
 * rest in their current order, then page problems, out-of-season, sold-out and not-on-sale products. Each entry:
 * `{ id, group, from, to }` (positions from 0).
 */
export function proposeOrder(items) {
  const groups = groupsOf(items);
  const entries = items.map((p, i) => ({ p, group: groups[i], from: i }));
  const byMoney = (a, b) => (b.p.moneyAtStake ?? 0) - (a.p.moneyAtStake ?? 0);
  const within = {
    bestseller: (a, b) => b.p.revenue30 - a.p.revenue30,
    bestseller_low: (a, b) => b.p.revenue30 - a.p.revenue30,
    hidden_gem: byMoney,
    needs_sales: byMoney,
  };
  entries.sort((a, b) => RANK.get(a.group) - RANK.get(b.group) || within[a.group]?.(a, b) || a.from - b.from);
  return entries.map((e, to) => ({ id: e.p.id, group: e.group, from: e.from, to }));
}

/** How many products a new order moves. */
export const movedCount = (current, target) => target.filter((id, i) => current[i] !== id).length;
