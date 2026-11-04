// The Fix center page (the owner's design): word counts, highlighted [fill in: …] parts, which drafts
// differ from the live product, what blocks applying them, and the checklist from the diagnosis.
// Pure (relative imports only) so node:test can load it.

import { FILL_IN, fillInsLeft } from "./ai-text.js";
import { MATERIAL_WORDS, SIZE_WORDS, USE_WORDS } from "./diagnosis.js";
import { REASON_TITLES } from "./diagnosis-titles.js";

/** A description's HTML as plain text: tags (and their attributes) and entities left out. */
export function plainText(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words in a description's HTML. */
export function wordCount(html) {
  return plainText(html).split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** A text split into plain parts and `[fill in: …]` placeholders: `[{ text, fillIn }]`. */
export function fillInParts(text) {
  const s = String(text ?? "");
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(FILL_IN)) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index), fillIn: false });
    parts.push({ text: m[0], fillIn: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ text: s.slice(last), fillIn: false });
  return parts;
}

/** The fixes in the order they're applied. */
export const FIX_TYPES = ["title", "description", "seo", "images", "collection"];

const manualIds = (live) => (live.collections ?? []).filter((c) => c.manual).map((c) => c.id);

/**
 * Which fixes the drafts change against the live product, in the order they're applied. `d`: `{ title,
 * description, seoTitle, seoDescription, mediaIds, collectionIds }`.
 */
export function changedTypes(live, d) {
  if (!live) return [];
  const changed = {
    title: d.title.trim() !== live.title,
    description: d.description !== live.descriptionHtml,
    seo: d.seoTitle.trim() !== (live.seo?.title ?? "") || d.seoDescription.trim() !== (live.seo?.description ?? ""),
    images: d.mediaIds.join() !== live.media.map((m) => m.id).join(),
    collection: [...d.collectionIds].sort().join() !== manualIds(live).sort().join(),
  };
  return FIX_TYPES.filter((t) => changed[t]);
}

/** Why the changed drafts can't be applied yet, or null when they can. */
export function applyBlocker(types, d) {
  if (types.includes("title")) {
    if (d.title.trim().length === 0) return "The title can't be empty.";
    if (d.title.trim().length > 255) return "The title can be at most 255 characters.";
  }
  if (types.includes("seo")) {
    if (d.seoTitle.trim().length > 70) return "The SEO title can be at most 70 characters.";
    if (d.seoDescription.trim().length > 320) return "The meta description can be at most 320 characters.";
  }
  const left = fillInsLeft(types.includes("description") ? d.description : "", ...(types.includes("seo") ? [d.seoTitle, d.seoDescription] : []));
  return left.length ? `Fill in ${left.join(", ")} first (where it says [fill in: …]).` : null;
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "From the diagnosis": each reason as a goal, ticked when the drafts meet it. `reasons`: `[{ code,
 * data }]`; `d`: the drafts plus `photoCount` (current photos and the AI photos picked to add).
 * Returns `[{ code, text, done }]`.
 */
export function checklist(reasons, d, live) {
  const types = changedTypes(live, d);
  return (reasons ?? []).map(({ code, data = {} }) => {
    switch (code) {
      case "few_images": {
        const min = data.minimum ?? 3;
        return { code, text: `At least ${min} photos`, done: d.photoCount >= min };
      }
      case "short_description": {
        const min = data.minimum ?? 80;
        return { code, text: `Description of ${min} words or more`, done: wordCount(d.description) >= min };
      }
      case "missing_details": {
        // The diagnosis's own word lists decide, on the text shoppers read (not the tags' attributes).
        const text = plainText(d.description);
        const done = SIZE_WORDS.test(text) && MATERIAL_WORDS.test(text) && USE_WORDS.test(text);
        return { code, text: "Size, material and use or care mentioned", done };
      }
      case "duplicate_description":
        return { code, text: "A description of its own", done: types.includes("description") };
      case "missing_seo":
        return { code, text: "SEO title and meta description", done: d.seoTitle.trim() !== "" && d.seoDescription.trim() !== "" };
      case "no_collection":
        // Automated collections count too (the product is in them by their rules).
        return { code, text: "In at least one collection", done: d.collectionIds.length > 0 || (live?.collections ?? []).some((c) => !c.manual) };
      case "low_traffic_collections": {
        const before = new Set(live ? manualIds(live) : []);
        return { code, text: "In a busier collection too", done: d.collectionIds.some((id) => !before.has(id)) };
      }
      case "broken_size_run": {
        const out = Array.isArray(data.outOfStock) ? data.outOfStock : [];
        return { code, text: out.length ? `${out.join(", ")} out of stock: restock` : "Out-of-stock variants: restock", done: false };
      }
      case "price_above_market":
      case "price_above_peers":
        return { code, text: "Price above the market: review it", done: false };
      case "returned_often":
        return { code, text: "Returned often: make the page match what arrives", done: false };
      case "store_checkout_issue":
        return { code, text: "Shoppers drop off at checkout: check shipping costs", done: false };
      default:
        return { code, text: capital(REASON_TITLES[code] ?? code), done: false };
    }
  });
}
