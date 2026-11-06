// Inbox — docs/PLAN.md module 11. Pure (relative imports only) so node:test can load it.
import { STATUS_INFO } from "./status-info.js";

/** Statuses that call for an action (everything but healthy and not analyzed). */
export const ACTION_STATUSES = ["dead_stock", "slow_mover", "page_problem", "hidden_gem", "stockout_risk"];

/**
 * After a scoring run: products that now need an action, by status. On the shop's first analysis
 * (no product scored before, only "excluded" rows at most) that is every product in an action status;
 * later only those that newly need one — a move from one problem status to another doesn't count.
 */
export function attentionSummary(previous, current) {
  const firstRun = ![...previous.values()].some((s) => s !== "excluded" && s !== "over_limit");
  const counts = {};
  for (const r of current) {
    if (!ACTION_STATUSES.includes(r.status) || (!firstRun && ACTION_STATUSES.includes(previous.get(r.id)))) continue;
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }
  return { firstRun, counts, total: Object.values(counts).reduce((s, n) => s + n, 0) };
}

const formatMoney = (n, currency) => {
  try {
    if (currency) return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {}
  return Math.round(n).toLocaleString("en-US");
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const needs = (n) => (n === 1 ? "needs" : "need");
const PLURAL = { slow_mover: "slow movers", page_problem: "page problems", hidden_gem: "hidden gems", stockout_risk: "stock-out risks" };
const statusList = (counts) =>
  ACTION_STATUSES.filter((s) => counts?.[s])
    .map((s) => `${counts[s]} ${counts[s] > 1 && PLURAL[s] ? PLURAL[s] : STATUS_INFO[s].label.toLowerCase()}`)
    .join(", ");

const VERDICTS = {
  improved: ["Fixes worked", "Sales improved after the fixes. Keep the changes."],
  worse: ["Fixes made it worse", "Undo them from the product page."],
  no_change: ["No change after fixes", "A markdown is proposed on the product page."],
  not_enough_data: ["Not enough data to judge the fixes", "Too few visits, or too little history before the fixes."],
};

/** Inbox text for a notification: title, body and where it leads. Unknown types still get a line. */
export function describe(n) {
  const title = n.productTitle ?? "a product";
  const product = n.productId ? `/products/${n.productId}` : "/";
  const markdown = n.productId ? `/products/${n.productId}/markdown` : "/";
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
      const statuses = ACTION_STATUSES.filter((s) => d.counts?.[s]);
      return {
        title: `${plural(need, "product")} newly ${needs(need)} attention`,
        body: `${statusList(d.counts)}.`,
        href: statuses.length === 1 ? `/products?status=${statuses[0]}` : "/products",
      };
    }
    case "rescue_verdict": {
      const [head, body] = VERDICTS[d.verdict] ?? ["Rescue plan finished", "See the result on the product page."];
      return { title: `${head}: ${title}`, body, href: product };
    }
    case "markdown_floor_reached":
      return { title: `Markdown reached the price floor: ${title}`, body: "Some variants can't be discounted further within your margin floor.", href: markdown };
    case "markdown_paused":
      return { title: `Markdown paused: ${title}`, body: "See why on its markdown page.", href: markdown };
    case "markdown_unsold":
      return { title: `Markdown finished, stock still unsold: ${title}`, body: "Consider a bundle or taking it off sale.", href: markdown };
    case "markdown_restore_failed":
      return { title: `Original prices couldn't be restored: ${title}`, body: "Shopify kept refusing the change. Check the product's prices.", href: markdown };
    case "price_guard":
      return {
        title: `Price below your margin floor: ${title}`,
        body: "The app raised its own price back to the floor, or the price was set by hand and needs a look.",
        href: markdown,
      };
    case "monthly_report": {
      const month = new Date(`${d.period}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      return { title: `Your ${month} report is ready`, body: `${formatMoney(d.revenueRecovered ?? 0, d.currency)} revenue recovered.`, href: `/reports?period=${d.period}` };
    }
    case "season_soon": {
      const when = new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "long", timeZone: "UTC" });
      const what = d.count === 1 ? title : plural(d.count ?? 0, "seasonal product");
      return {
        title: `Season starts ${when}: ${what}`,
        body: "Check stock and product pages before the season starts.",
        href: d.count === 1 && n.productId ? product : "/products?status=seasonal",
      };
    }
    case "season_ended": {
      const what = d.count === 1 ? title : plural(d.count ?? 0, "product");
      return {
        title: `Season ended with stock left: ${what}`,
        body: `${formatMoney(d.stockValue ?? 0, d.currency)} in stock. An end-of-season markdown clears it before the next season; start it on the product page.`,
        href: d.count === 1 && n.productId ? product : "/products?status=seasonal",
      };
    }
    case "weekly_plan": {
      const actions = d.actions ?? [];
      const first = actions[0];
      const results = d.lastWeek?.verdicts?.length ?? 0;
      const markdowns = (d.lastWeek?.markdownsStarted?.length ?? 0) + (d.lastWeek?.markdownsEnded?.length ?? 0);
      const recovered = d.lastWeek?.extraSales > 0 ? ` (${formatMoney(d.lastWeek.extraSales, d.currency)} extra sales)` : "";
      const todo = actions.length ? `${plural(actions.length, "action")}${first ? `, starting with ${first.title}` : ""}.` : "Nothing urgent this week.";
      const last = [results ? `${plural(results, "result")}${recovered}` : null, markdowns ? plural(markdowns, "markdown update") : null].filter(Boolean).join(", ");
      return {
        title: "Your plan for this week",
        body: `${todo}${last ? ` Last week: ${last}.` : ""}`,
        href: `/inbox?week=${d.week}`,
      };
    }
    case "ab_test_ended": {
      const part = { title: "title", description: "description", images: "photos" }[d.kind] ?? "page";
      const pct = d.chance == null ? null : Math.round((d.winner === "a" ? 1 - d.chance : d.chance) * 100);
      const [head, body] = {
        b_better: ["A/B test finished, B is better", `${pct}% chance B gets more add-to-carts. Use B now to keep it.`],
        a_better: ["A/B test finished, keep A", `${pct}% chance the page as it was does better. Your store shows it to everyone again.`],
        time: ["A/B test finished after 30 days", d.winner === "b" ? "B did better. Use B now to keep it." : d.winner === "a" ? "The page as it was did better; it shows to everyone again." : "No clear winner. Your store shows the page as it was to everyone again."],
        changed: ["A/B test stopped", `The product's ${part} changed in Shopify during the test, so the result wouldn't be fair. Start a new test.`],
        plan: ["A/B test stopped", "Your plan no longer includes A/B tests."],
        product_gone: ["A/B test stopped", "The product was deleted in Shopify."],
      }[d.reason] ?? ["A/B test finished", "See the result on the A/B tests page."];
      return { title: `${head}: ${title}`, body, href: "/ab-tests" };
    }
    default:
      return { title: n.type.replaceAll("_", " "), body: "", href: product };
  }
}
