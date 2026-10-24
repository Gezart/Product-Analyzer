// Inbox — docs/PLAN.md module 11. Pure (relative imports only) so node:test can load it.
import { STATUS_INFO } from "./status-info.js";

/** Statuses that call for an action (everything but healthy and not analyzed). */
export const ACTION_STATUSES = ["dead_stock", "slow_mover", "page_problem", "hidden_gem", "stockout_risk"];

/**
 * After a scoring run: products that now need an action, by status. On the shop's first run that is
 * every product in an action status; later only those whose status changed into one.
 */
export function attentionSummary(previous, current) {
  const firstRun = previous.size === 0;
  const counts = {};
  for (const r of current) {
    if (!ACTION_STATUSES.includes(r.status) || (!firstRun && previous.get(r.id) === r.status)) continue;
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }
  return { firstRun, counts, total: Object.values(counts).reduce((s, n) => s + n, 0) };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const needs = (n) => (n === 1 ? "needs" : "need");
const PLURAL = { slow_mover: "slow movers", page_problem: "page problems", hidden_gem: "hidden gems", stockout_risk: "stock-out risks" };
const statusList = (counts) =>
  ACTION_STATUSES.filter((s) => counts?.[s])
    .map((s) => `${counts[s]} ${counts[s] > 1 && PLURAL[s] ? PLURAL[s] : STATUS_INFO[s].label.toLowerCase()}`)
    .join(", ");

const VERDICTS = {
  improved: ["Fixes worked", "Conversion and sales are up. Keep the changes."],
  worse: ["Fixes made it worse", "Undo the fixes with one click on the product page."],
  no_change: ["No change after fixes", "A markdown is proposed on the product page."],
  not_enough_data: ["Not enough data to judge the fixes", "The product had too few views in the window."],
};

/** Inbox text for a notification: title, body and where it leads. Unknown types still get a line. */
export function describe(n) {
  const title = n.productTitle ?? "a product";
  const product = n.productId ? `/products/${n.productId}` : "/";
  const d = n.data ?? {};
  switch (n.type) {
    case "analysis_ready": {
      const need = Object.values(d.counts ?? {}).reduce((s, x) => s + x, 0);
      return {
        title: "Your first analysis is ready",
        body: `${plural(d.products ?? 0, "product")} analyzed${need ? `; ${need} ${needs(need)} attention (${statusList(d.counts)})` : ""}.`,
        href: "/",
      };
    }
    case "new_attention": {
      const need = Object.values(d.counts ?? {}).reduce((s, x) => s + x, 0);
      return { title: `${plural(need, "product")} newly ${needs(need)} attention`, body: `${statusList(d.counts)}.`, href: "/" };
    }
    case "rescue_verdict": {
      const [head, body] = VERDICTS[d.verdict] ?? ["Rescue plan finished", "See the result on the product page."];
      return { title: `${head}: ${title}`, body, href: product };
    }
    case "markdown_floor_reached":
      return { title: `Markdown reached the price floor: ${title}`, body: "Some variants can't be discounted further within your margin floor.", href: product };
    case "markdown_paused":
      return { title: `Markdown paused: ${title}`, body: "See why on the product page.", href: product };
    case "markdown_unsold":
      return { title: `Markdown finished, stock still unsold: ${title}`, body: "Consider a bundle or taking it off sale.", href: product };
    case "markdown_restore_failed":
      return { title: `Original prices couldn't be restored: ${title}`, body: "Shopify kept refusing the change. Check the product's prices.", href: product };
    case "price_guard":
      return {
        title: `Price below your margin floor: ${title}`,
        body: "The app raised its own price back to the floor, or the price was set by hand and needs a look.",
        href: product,
      };
    default:
      return { title: n.type.replaceAll("_", " "), body: "", href: product };
  }
}
