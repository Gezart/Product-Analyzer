// The product page (the owner's design): where each diagnosis reason leads, the next step, the six
// numbers, the daily sales bars and the markdown card. Pure (relative imports only) so node:test can load it.

import { floorPrice } from "./markdown.js";

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
  const inFixCenter = (reasons ?? []).some((r) => FIX_REASONS[r.code]);
  const first = reasonAction(reasons[0].code, productId);
  return {
    text: `${text[0].toUpperCase()}${text.slice(1)}.${inFixCenter ? " A rescue plan then measures the result for 14–30 days." : ""}`,
    cta: inFixCenter ? { label: "Start in Fix center", href: `/products/${productId}/fix` } : { label: first.cta, href: first.href },
  };
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
