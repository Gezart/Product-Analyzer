// Fix center — docs/PLAN.md module 5. Pure (no imports) so node:test can load it.
// A fix moves one part of a product from a `before` state (read from Shopify just before applying)
// to an `after` state; undo writes `before` back.

export type FixType = "title" | "description" | "seo" | "images" | "collection";

export type FixState = {
  title: { title: string };
  description: { descriptionHtml: string };
  seo: { seoTitle: string; seoDescription: string };
  /** Media ids in display order. */
  images: { mediaIds: string[] };
  /** Manual collections the product is in (smart collections are rule-based and can't be edited). */
  collection: { collectionIds: string[] };
};

export const FIX_TYPES: FixType[] = ["title", "description", "seo", "images", "collection"];

const LIMITS = { title: 255, descriptionHtml: 100_000, seoTitle: 70, seoDescription: 320 };
const GID = (type: string) => new RegExp(`^gid://shopify/${type}/\\d+$`);

/** Validates the merchant's edit for one fix type. Returns the clean state or an error message. */
export function validateFix(type: string, raw: unknown): { ok: true; type: FixType; after: FixState[FixType] } | { ok: false; error: string } {
  const v = (raw ?? {}) as Record<string, unknown>;
  const str = (key: string, max: number, required = false) => {
    const value = v[key];
    if (typeof value !== "string") return { error: `${key} must be text` };
    const trimmed = key === "descriptionHtml" ? value : value.trim();
    if (required && !trimmed) return { error: `${key} can't be empty` };
    if (trimmed.length > max) return { error: `${key} is longer than ${max} characters` };
    return { value: trimmed };
  };
  const ids = (key: string, gid: RegExp, max: number) => {
    const value = v[key];
    if (!Array.isArray(value) || value.length > max || !value.every((x) => typeof x === "string" && gid.test(x))) {
      return { error: `${key} must be a list of ids` };
    }
    if (new Set(value).size !== value.length) return { error: `${key} has duplicates` };
    return { value: value as string[] };
  };

  switch (type) {
    case "title": {
      const t = str("title", LIMITS.title, true);
      return "error" in t ? { ok: false, error: t.error! } : { ok: true, type, after: { title: t.value! } };
    }
    case "description": {
      const d = str("descriptionHtml", LIMITS.descriptionHtml);
      return "error" in d ? { ok: false, error: d.error! } : { ok: true, type, after: { descriptionHtml: d.value! } };
    }
    case "seo": {
      const t = str("seoTitle", LIMITS.seoTitle);
      if ("error" in t) return { ok: false, error: t.error! };
      const d = str("seoDescription", LIMITS.seoDescription);
      if ("error" in d) return { ok: false, error: d.error! };
      return { ok: true, type, after: { seoTitle: t.value!, seoDescription: d.value! } };
    }
    case "images": {
      const m = ids("mediaIds", /^gid:\/\/shopify\/(MediaImage|Video|ExternalVideo|Model3d)\/\d+$/, 250);
      return "error" in m ? { ok: false, error: m.error! } : { ok: true, type, after: { mediaIds: m.value! } };
    }
    case "collection": {
      const c = ids("collectionIds", GID("Collection"), 250);
      return "error" in c ? { ok: false, error: c.error! } : { ok: true, type, after: { collectionIds: [...c.value!].sort() } };
    }
    default:
      return { ok: false, error: `Unknown fix type ${type}` };
  }
}

/** Same state? Collections compare as sets; image order matters. */
export function sameState(type: FixType, a: unknown, b: unknown): boolean {
  if (type === "collection") {
    const x = [...((a as FixState["collection"]).collectionIds ?? [])].sort();
    const y = [...((b as FixState["collection"]).collectionIds ?? [])].sort();
    return x.length === y.length && x.every((id, i) => id === y[i]);
  }
  return JSON.stringify(a) === JSON.stringify(b, Object.keys(a as object));
}

/** Collections to add and remove to go from `current` to `target`. */
export function collectionChanges(current: string[], target: string[]) {
  const now = new Set(current);
  const want = new Set(target);
  return { add: target.filter((id) => !now.has(id)), remove: current.filter((id) => !want.has(id)) };
}

/**
 * Moves for Shopify's productReorderMedia to turn `current` into `target` (same ids). Only media whose
 * position changes are moved; ids missing from either list are left alone.
 */
export function mediaMoves(current: string[], target: string[]) {
  const ordered = target.filter((id) => current.includes(id));
  return ordered.flatMap((id, i) => (current[i] === id ? [] : [{ id, newPosition: String(i) }]));
}

/** A hint per diagnosis reason: what to change, for the fix center. */
export const FIX_HINTS: Record<string, { type: FixType; hint: string }> = {
  price_above_peers: { type: "description", hint: "Explain what justifies the price (quality, material, what's included) — or consider a rescue plan." },
  few_images: { type: "images", hint: "Add at least 3 images in Shopify, then put the clearest product shot first." },
  short_description: { type: "description", hint: "Write at least 80 words: what it is, who it's for, and why it's worth it." },
  missing_details: { type: "description", hint: "Add size or dimensions, material, and how to use or care for it." },
  duplicate_description: { type: "description", hint: "Write a description of its own; copied text reads as filler." },
  missing_seo: { type: "seo", hint: "Add an SEO title (up to 70 characters) and a meta description (up to 320)." },
  no_collection: { type: "collection", hint: "Add it to at least one collection shoppers browse." },
  low_traffic_collections: { type: "collection", hint: "Add it to a busier collection, too." },
};
