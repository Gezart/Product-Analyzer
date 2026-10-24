// Fix center — docs/PLAN.md module 5. Pure (no imports) so node:test can load it.
// A fix moves one part of a product from a `before` state (read from Shopify just before applying)
// to an `after` state; undo writes `before` back.

export const FIX_TYPES = ["title", "description", "seo", "images", "collection"];

const LIMITS = { title: 255, descriptionHtml: 100_000, seoTitle: 70, seoDescription: 320 };
const GID = (type) => new RegExp(`^gid://shopify/${type}/\\d+$`);

/** Validates the merchant's edit for one fix type. Returns the clean state or an error message. */
export function validateFix(type, raw) {
  const v = (raw ?? {});
  const str = (key, max, required = false) => {
    const value = v[key];
    if (typeof value !== "string") return { error: `${key} must be text` };
    const trimmed = key === "descriptionHtml" ? value : value.trim();
    if (required && !trimmed) return { error: `${key} can't be empty` };
    if (trimmed.length > max) return { error: `${key} is longer than ${max} characters` };
    return { value: trimmed };
  };
  const ids = (key, gid, max) => {
    const value = v[key];
    if (!Array.isArray(value) || value.length > max || !value.every((x) => typeof x === "string" && gid.test(x))) {
      return { error: `${key} must be a list of ids` };
    }
    if (new Set(value).size !== value.length) return { error: `${key} has duplicates` };
    return { value: value };
  };

  switch (type) {
    case "title": {
      const t = str("title", LIMITS.title, true);
      return "error" in t ? { ok: false, error: t.error } : { ok: true, type, after: { title: t.value } };
    }
    case "description": {
      const d = str("descriptionHtml", LIMITS.descriptionHtml);
      return "error" in d ? { ok: false, error: d.error } : { ok: true, type, after: { descriptionHtml: d.value } };
    }
    case "seo": {
      const t = str("seoTitle", LIMITS.seoTitle);
      if ("error" in t) return { ok: false, error: t.error };
      const d = str("seoDescription", LIMITS.seoDescription);
      if ("error" in d) return { ok: false, error: d.error };
      return { ok: true, type, after: { seoTitle: t.value, seoDescription: d.value } };
    }
    case "images": {
      const m = ids("mediaIds", /^gid:\/\/shopify\/(MediaImage|Video|ExternalVideo|Model3d)\/\d+$/, 250);
      return "error" in m ? { ok: false, error: m.error } : { ok: true, type, after: { mediaIds: m.value } };
    }
    case "collection": {
      const c = ids("collectionIds", GID("Collection"), 250);
      return "error" in c ? { ok: false, error: c.error } : { ok: true, type, after: { collectionIds: [...c.value].sort() } };
    }
    default:
      return { ok: false, error: `Unknown fix type ${type}` };
  }
}

/** Same state? Collections compare as sets; image order matters. */
export function sameState(type, a, b) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (type === "collection") {
    const x = [...((a).collectionIds ?? [])].sort();
    const y = [...((b).collectionIds ?? [])].sort();
    return x.length === y.length && x.every((id, i) => id === y[i]);
  }
  return JSON.stringify(a) === JSON.stringify(b, Object.keys(a));
}

/** Collections to add and remove to go from `current` to `target`. */
export function collectionChanges(current, target) {
  const now = new Set(current);
  const want = new Set(target);
  return { add: target.filter((id) => !now.has(id)), remove: current.filter((id) => !want.has(id)) };
}

/**
 * Moves for Shopify's productReorderMedia to turn `current` into `target`. Shopify applies moves in
 * order, each to the list the previous one left, so every item from the first differing position on
 * is placed in turn — correct whether moves apply one by one or all at once. Ids not in both lists
 * are left alone.
 */
export function mediaMoves(current, target) {
  const have = new Set(current);
  const ordered = target.filter((id) => have.has(id));
  const start = ordered.findIndex((id, i) => current[i] !== id);
  if (start === -1) return [];
  return ordered.slice(start).map((id, j) => ({ id, newPosition: String(start + j) }));
}

/** Applies moves in order, the way Shopify does (for tests and checks). */
export function applyMoves(list, moves) {
  const out = [...list];
  for (const m of moves) {
    const from = out.indexOf(m.id);
    if (from === -1) continue;
    out.splice(from, 1);
    out.splice(Number(m.newPosition), 0, m.id);
  }
  return out;
}

/** A hint per diagnosis reason: what to change, for the fix center. */
export const FIX_HINTS = {
  price_above_peers: { type: "description", hint: "Explain what justifies the price (quality, material, what's included) — or consider a rescue plan." },
  few_images: { type: "images", hint: "Add at least 3 images in Shopify, then put the clearest product shot first." },
  short_description: { type: "description", hint: "Write at least 80 words: what it is, who it's for, and why it's worth it." },
  missing_details: { type: "description", hint: "Add size or dimensions, material, and how to use or care for it." },
  duplicate_description: { type: "description", hint: "Write a description of its own; copied text reads as filler." },
  missing_seo: { type: "seo", hint: "Add an SEO title (up to 70 characters) and a meta description (up to 320)." },
  no_collection: { type: "collection", hint: "Add it to at least one collection shoppers browse." },
  low_traffic_collections: { type: "collection", hint: "Add it to a busier collection, too." },
};
