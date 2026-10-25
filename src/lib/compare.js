// Compare products — docs/PLAN.md module 9. Pure (relative imports only) so node:test can load it.
import { DAY_MS } from "./dates.js";
import { MATERIAL_WORDS, MIN_IMAGES, MIN_WORDS, SIZE_WORDS, USE_WORDS } from "./diagnosis.js";

export const MAX_COMPARE = 4;

/** `ids` from the query string: comma-separated product ids or Shopify GIDs, 1–4 distinct ones, or null. */
export function parseCompareIds(raw) {
  const ids = [...new Set(String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  return ids.length >= 1 && ids.length <= MAX_COMPARE && ids.every((id) => id.length <= 100) ? ids : null;
}

/**
 * Page quality, 0–100: the share of the diagnosis's per-product page checks that pass. Text and SEO
 * checks count only when that page data has been synced (as in the diagnosis).
 */
export function pageQuality(p) {
  const text = p.description ?? "";
  const checks = [
    { key: "images", label: `At least ${MIN_IMAGES} images`, ok: p.imageCount >= MIN_IMAGES },
    { key: "words", label: `Description of ${MIN_WORDS}+ words`, ok: p.descriptionWords >= MIN_WORDS },
    ...(p.pageDataKnown
      ? [
          { key: "size", label: "Mentions size or dimensions", ok: SIZE_WORDS.test(text) },
          { key: "material", label: "Mentions material", ok: MATERIAL_WORDS.test(text) },
          { key: "use", label: "Mentions use or care", ok: USE_WORDS.test(text) },
          { key: "seoTitle", label: "SEO title", ok: Boolean(p.seoTitle) },
          { key: "seoDescription", label: "Meta description", ok: Boolean(p.seoDescription) },
        ]
      : []),
    { key: "collection", label: "In a collection", ok: p.collections > 0 },
  ];
  return { score: Math.round((100 * checks.filter((c) => c.ok).length) / checks.length), checks };
}

/**
 * Gross margin at today's prices: (price − cost) ÷ price, averaged over the variants with a known
 * unit cost. Null when no variant has one. A cost of 0 counts as not set, as for the price floor.
 */
export function grossMargin(variants) {
  const known = variants.filter((v) => v.cost != null && v.cost > 0 && v.price > 0);
  const margin = known.length ? known.reduce((s, v) => s + (v.price - v.cost) / v.price, 0) / known.length : null;
  return { margin, withCost: known.length, variants: variants.length };
}

/**
 * Stock age: days since the last sale. With no sale in the known order history, the product's age
 * if it is younger than that history; otherwise "at least" the length of the history.
 */
export function stockAge({ today, lastSale, createdAt, knownDays }) {
  const since = (date) => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS));
  if (lastSale) return { days: since(lastSale), atLeast: false, sold: true };
  const age = createdAt ? since(createdAt) : null;
  if (age != null && age <= knownDays) return { days: age, atLeast: false, sold: false };
  return knownDays > 0 ? { days: knownDays, atLeast: true, sold: false } : { days: null, atLeast: false, sold: false };
}

/** Index of the best value in a row (highest, or lowest with `lowerIsBetter`); null on a tie or with fewer than 2 values. */
export function bestIndex(values, lowerIsBetter = false) {
  const known = values.map((v, i) => [v, i]).filter(([v]) => v != null && Number.isFinite(v));
  if (known.length < 2) return null;
  const best = known.reduce((a, b) => ((lowerIsBetter ? b[0] < a[0] : b[0] > a[0]) ? b : a));
  return known.filter(([v]) => v === best[0]).length > 1 ? null : best[1];
}
