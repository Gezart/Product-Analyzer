// The product page (the owner's design): where each diagnosis reason leads, the next step, the six
// numbers, the daily sales bars and the markdown card. Pure (relative imports only) so node:test can load it.

import { floorPrice } from "./markdown.js";
import { seasonGraceDays } from "./scoring.js";
import { formatDays, STATUS_INFO } from "./status-info.js";

const FIX_REASONS = {
  few_images: { cta: "Create photos with AI", section: "photos", step: "add photos" },
  short_description: { cta: "Write with AI", section: "description", step: "write a fuller description" },
  missing_details: { cta: "Write with AI", section: "description", step: "write a fuller description" },
  duplicate_description: { cta: "Write with AI", section: "description", step: "give it its own description" },
  missing_seo: { cta: "Fix SEO", section: "seo", step: "complete its SEO" },
  no_collection: { cta: "Add to a collection", section: "collections", step: "add it to a collection" },
  low_traffic_collections: { cta: "Add to a collection", section: "collections", step: "put it in a busier collection" },
};
const PAGE_REASONS = {
  price_above_market: { cta: "Review price", href: "#market", step: "check the price" },
  price_above_peers: { cta: "Compare", step: "check the price" },
  broken_size_run: { cta: "See variants", href: "#variants", step: "restock the missing variants" },
  returned_often: { cta: "See returns", href: "#returns", step: "find out why it comes back" },
  store_checkout_issue: { cta: "See sales", href: "#sales", step: "check your checkout" },
};

/** The button next to a diagnosis reason: `{ cta, href }` (a Fix center section, or a part of this page). */
export function reasonAction(code, productId) {
  const fix = FIX_REASONS[code];
  if (fix) return { cta: fix.cta, href: `/products/${productId}/fix#${fix.section}` };
  if (code === "price_above_peers") return { cta: PAGE_REASONS[code].cta, href: `/compare?ids=${productId}` };
  const page = PAGE_REASONS[code];
  return page ? { cta: page.cta, href: page.href } : { cta: "See the data", href: "#sales" };
}

/** Old links to sections that are now elsewhere on the page (diagnosis links, saved weekly plans). */
export const SECTION_ALIASES = { page: "diagnosis", overview: "diagnosis", metrics: "sales" };

/**
 * The next step from the diagnosis: "add photos, write a fuller description and check the price", with
 * where to start (the Fix center when any of them is fixed there). Null without reasons.
 */
export function nextFromReasons(reasons, productId) {
  const steps = [];
  for (const r of reasons ?? []) {
    const step = (FIX_REASONS[r.code] ?? PAGE_REASONS[r.code])?.step;
    if (step && !steps.includes(step)) steps.push(step);
  }
  if (steps.length === 0) return null;
  const top = steps.slice(0, 3);
  const text = top.length === 1 ? top[0] : `${top.slice(0, -1).join(", ")} and ${top.at(-1)}`;
  const sentence = `${text[0].toUpperCase()}${text.slice(1)}.`;
  if (reasons.some((r) => FIX_REASONS[r.code])) {
    return { text: `${sentence} A rescue plan then measures the result for 14–30 days.`, cta: { label: "Start in Fix center", href: `/products/${productId}/fix` } };
  }
  // Without a Fix center reason: the first reason that has a place of its own.
  const first = reasonAction(reasons.find((r) => PAGE_REASONS[r.code]).code, productId);
  return { text: sentence, cta: { label: first.cta, href: first.href } };
}

const dayMs = 86_400_000;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

/** "Today", "Yesterday" or "3 days ago" for the last sale, from the store's `today`; null without one. */
export function lastSaleLabel(lastSale, today) {
  if (!lastSale) return null;
  const days = Math.max(0, daysBetween(lastSale, today));
  return days === 0 ? { value: "Today", sub: "" } : days === 1 ? { value: "Yesterday", sub: "" } : { value: `${days.toLocaleString()} days`, sub: "ago" };
}

/**
 * The daily sales bars for the last `days` days (of the 90 the page has): each `{ date, units, known,
 * height }` with height 0–1 of the busiest day, and the total sold.
 */
export function salesBars(daily, days) {
  const shown = (daily ?? []).slice(-days);
  const peak = Math.max(0, ...shown.map((d) => d.units));
  return {
    bars: shown.map((d) => ({ ...d, height: peak > 0 ? d.units / peak : 0 })),
    total: shown.reduce((n, d) => n + d.units, 0),
    peak,
  };
}

/**
 * The markdown card: `{ state, body, cta }`. `md` is the product API's `markdown` (the running plan, why
 * one could start, the ladder and the margin floor), `variants` its variants (with cost), `money` a formatter.
 */
export function markdownCard(md, variants, money) {
  const ladder = `${md.steps.map((s) => `${Math.round(s * 100)}%`).join(" → ")} every ${md.stepDays} days`;
  if (md.running) {
    const state = md.running.status === "paused" ? "Paused" : md.running.step ? `Step ${md.running.step} of ${md.steps.length}` : "Starting";
    return { state, body: `${ladder}. Never below ${money.format(md.running.floor)}.`, cta: "See the markdown" };
  }
  // The lowest price a markdown could reach: the lowest floor among variants with a known cost.
  let lowest = null;
  for (const v of variants ?? []) {
    const floor = floorPrice(v.cost, md.marginFloorPct);
    if (floor != null && (lowest == null || floor < lowest.floor)) lowest = { floor, cost: v.cost };
  }
  const never = lowest
    ? `Never below ${money.format(lowest.floor)} (cost ${money.format(lowest.cost)} + ${md.marginFloorPct}% margin).`
    : `Never below cost + ${md.marginFloorPct}% margin; add unit costs in Shopify so a markdown can run.`;
  if (md.reason) return { state: "Ready", body: `${md.reason} ${ladder}. ${never}`, cta: "Start markdown" };
  return { state: "Not needed now", body: `For dead stock, or when a rescue plan changes nothing: ${ladder}. ${never}`, cta: "See the markdown" };
}

/** What a seasonal product needs now: nothing until its season, or a little time early in it. */
export function seasonalNext(season) {
  if (!season.inSeason) return `Nothing until its season (${season.label}) starts in ${season.daysToStart} day${season.daysToStart === 1 ? "" : "s"}; it isn't dead stock.`;
  const left = seasonGraceDays(season.seasonDays) - season.daysIntoSeason;
  if (left <= 0) return `Its season (${season.label}) is underway; it's judged at the next nightly analysis.`;
  return `Its season (${season.label}) has just started; it's judged in ${left} day${left === 1 ? "" : "s"}.`;
}

/**
 * What to do next on the product page: a running markdown or rescue plan first, then a markdown that's
 * due (as the weekly plan says), the season, the diagnosis's reasons, and the status's general advice.
 * `data` is the product API's answer, `reasons` the diagnosis's (or null while it runs). Returns
 * `{ text, cta: { label, href } | null }` or null.
 */
export function nextStep(data, reasons) {
  const id = data.product.id;
  const rescue = data.rescuePlan;
  const season = data.product.season;
  const status = data.score?.status;
  const md = data.markdown;
  const markdownHref = `/products/${id}/markdown`;
  const rescueCta = { label: "See the rescue plan", href: "#rescue" };
  if (md?.running) {
    return md.running.status === "paused"
      ? { text: "The markdown is paused: no further price steps for now.", cta: { label: "See why", href: markdownHref } }
      : { text: `A markdown is running: its price steps down every ${md.stepDays} days until the stock sells.`, cta: { label: "Open the markdown", href: markdownHref } };
  }
  if (rescue && !rescue.verdict) return { text: "Wait for the rescue plan's result: it's measuring the fixes.", cta: rescueCta };
  if (rescue?.verdict === "worse" && rescue.fixIds.length > 0) {
    const allMoves = (rescue.moves ?? []).length === rescue.fixIds.length;
    return { text: allMoves ? "Sales fell after the new collection order: undo it." : "Sales fell after the fixes: undo them.", cta: rescueCta };
  }
  if (md?.reason) {
    const text = md.reasonKind === "end_of_season" ? md.reason : `${md.reason} Clear the stock with a stepped markdown.`;
    return { text, cta: { label: "Start markdown", href: markdownHref } };
  }
  if (status === "seasonal" && season) return { text: seasonalNext(season), cta: null };
  if (["dead_stock", "slow_mover", "page_problem"].includes(status)) {
    return nextFromReasons(reasons, id) ?? { text: `${STATUS_INFO[status].action}.`, cta: { label: "Start in Fix center", href: `/products/${id}/fix` } };
  }
  if (status === "hidden_gem") return { text: "Give it a better place in its collections: it sells well to the few who see it.", cta: { label: "Open Collections", href: "/collections" } };
  if (status === "stockout_risk") return { text: "Reorder before it sells out.", cta: { label: "See variants", href: "#variants" } };
  if (status === "over_limit") return { text: `${STATUS_INFO.over_limit.action}.`, cta: { label: "See plans", href: "/plans" } };
  return STATUS_INFO[status] ? { text: `${STATUS_INFO[status].action}.`, cta: null } : null;
}

const pct0 = (n) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const pct1 = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

/** The six numbers under the header, each `{ label, value, sub }`. `money` formats the store's currency. */
export function productNumbers(data, money) {
  const s = data.score;
  const analyzed = Boolean(s) && !["over_limit", "excluded", "unscored"].includes(s.status);
  const season = data.product.season;
  const w30 = data.windows[0];
  const last = lastSaleLabel(data.lastSale, data.today);
  const days = data.untracked
    ? { value: "—", sub: "sells without stock" }
    : data.daysOfCover != null
      ? { value: formatDays(data.daysOfCover), sub: "at today's pace" }
      : data.stock > 0
        ? { value: "over a year", sub: "no sales in 30 days" }
        : { value: "—", sub: "no stock" };
  return [
    {
      label: "Money at stake",
      value: analyzed ? money.format(s.moneyAtStake) : "—",
      sub: !analyzed ? "not analyzed" : s.moneyAtStake > 0 && s.stockValue > 0 ? `${pct0(s.moneyAtStake / s.stockValue)} of stock value` : "",
    },
    {
      label: "Stock",
      value: data.untracked ? "—" : data.stock.toLocaleString(),
      sub: data.untracked ? "sells without stock" : `${money.format(data.stockValue)} at cost${data.stockValueIsEstimate ? " (est.)" : ""}`,
    },
    { label: "Sell-through", value: pct0(s?.sellThrough ?? null), sub: season?.inSeason && season.daysIntoSeason < 60 ? "season so far" : "last 60 days" },
    { label: "Days of stock", ...days },
    {
      label: "Conversion",
      value: pct1(w30.viewToPurchase),
      sub:
        w30.viewToPurchase != null && data.storeConversion != null
          ? `store average ${pct1(data.storeConversion)}`
          : w30.views > 0
            ? `${w30.views.toLocaleString()} visits in 30 days`
            : "no visit data yet",
    },
    { label: "Last sale", value: last?.value ?? "None", sub: last ? last.sub : "in known history" },
  ];
}
