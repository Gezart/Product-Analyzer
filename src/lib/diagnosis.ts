// Rule-based diagnosis — docs/PLAN.md → "Diagnosis rules (v1)". Rules find the problem; every reason
// carries its evidence (the numbers that triggered it) and the page section that shows them.
// Pure (no imports) so node:test can load it. AI explanations are v2.

export type Severity = "high" | "medium" | "low";

export type Reason = {
  code:
    | "price_above_peers"
    | "few_images"
    | "short_description"
    | "missing_details"
    | "duplicate_description"
    | "missing_seo"
    | "broken_size_run"
    | "no_collection"
    | "low_traffic_collections"
    | "store_checkout_issue";
  severity: Severity;
  /** One sentence with the numbers. */
  evidence: string;
  /** The values behind the sentence. */
  data: Record<string, unknown>;
  /** Product page section that shows the data. */
  link: "#overview" | "#metrics" | "#variants" | "#page";
};

export type DiagnosisProduct = {
  id: string;
  price: number;
  productType: string | null;
  collections: string[];
  imageCount: number;
  description: string | null;
  descriptionWords: number;
  seoTitle: string | null;
  seoDescription: string | null;
  variants: { title: string; stock: number }[];
  views30: number;
  carts30: number;
  purchases30: number;
};

/** Store-wide numbers the rules compare against (built once per shop). */
export type DiagnosisContext = {
  /** Active product prices by product type and by collection id. */
  pricesByType: Map<string, number[]>;
  pricesByCollection: Map<string, number[]>;
  /** Normalized description → product ids using it. */
  descriptions: Map<string, string[]>;
  /** 30-day views per collection id (only when view data exists). */
  collectionViews: Map<string, number>;
  /** Store medians over products with views; null without view data. */
  medianViewToCart: number | null;
  medianCartToPurchase: number | null;
  minViews: number;
};

const PRICE_ABOVE = 0.25;
const MIN_PEERS = 3;
const MIN_IMAGES = 3;
const MIN_WORDS = 80;
const MIN_WORDS_FOR_DUPLICATE = 20;

const SIZE_WORDS = /\b(size|sizes|sizing|fit|fits|dimensions?|cm|mm|inch|inches|length|width|height|weight|kg|ml|oz|xs|xl)\b/i;
const MATERIAL_WORDS = /\b(material|materials|made of|made from|fabric|cotton|wool|linen|silk|leather|polyester|nylon|steel|wood|wooden|glass|ceramic|plastic|metal|gold|silver)\b/i;
const USE_WORDS = /\b(use|uses|care|wash|washable|how to|ideal for|perfect for|suitable for|great for|designed for)\b/i;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function normalizeDescription(text: string | null): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Peer median excluding the product itself, so one expensive product can't hide behind its own price. */
function peerMedian(prices: number[] | undefined, own: number): { median: number; count: number } | null {
  if (!prices) return null;
  const others = [...prices];
  const i = others.indexOf(own);
  if (i >= 0) others.splice(i, 1);
  const m = median(others);
  return m != null && others.length >= MIN_PEERS && m > 0 ? { median: m, count: others.length } : null;
}

export function diagnose(p: DiagnosisProduct, ctx: DiagnosisContext): Reason[] {
  const reasons: Reason[] = [];

  // 1. Price more than 25% above the median of the same product type or collection (largest gap wins).
  const groups: { label: string; key: string; peers: { median: number; count: number } | null }[] = [
    ...(p.productType ? [{ label: `product type "${p.productType}"`, key: p.productType, peers: peerMedian(ctx.pricesByType.get(p.productType), p.price) }] : []),
    ...p.collections.map((c) => ({ label: "the same collection", key: c, peers: peerMedian(ctx.pricesByCollection.get(c), p.price) })),
  ];
  const worst = groups
    .filter((g) => g.peers)
    .map((g) => ({ ...g, above: p.price / g.peers!.median - 1 }))
    .sort((a, b) => b.above - a.above)[0];
  if (worst && worst.above > PRICE_ABOVE) {
    reasons.push({
      code: "price_above_peers",
      severity: worst.above > 0.5 ? "high" : "medium",
      evidence: `Price is ${pct(worst.above)} above the median ${worst.peers!.median.toFixed(2)} of ${worst.peers!.count} other products in ${worst.label}.`,
      data: { price: p.price, peerMedian: worst.peers!.median, peers: worst.peers!.count, group: worst.key, abovePct: worst.above },
      link: "#overview",
    });
  }

  // 2. Fewer than 3 images.
  if (p.imageCount < MIN_IMAGES) {
    reasons.push({
      code: "few_images",
      severity: p.imageCount === 0 ? "high" : "medium",
      evidence: `Only ${p.imageCount} image${p.imageCount === 1 ? "" : "s"} (at least ${MIN_IMAGES} recommended).`,
      data: { images: p.imageCount, minimum: MIN_IMAGES },
      link: "#page",
    });
  }

  // 3. Description: too short, missing size/material/use, or copied from another product.
  if (p.descriptionWords < MIN_WORDS) {
    reasons.push({
      code: "short_description",
      severity: p.descriptionWords < 20 ? "high" : "medium",
      evidence: `Description has ${p.descriptionWords} words (at least ${MIN_WORDS} recommended).`,
      data: { words: p.descriptionWords, minimum: MIN_WORDS },
      link: "#page",
    });
  }
  const text = p.description ?? "";
  const missing = [
    ...(SIZE_WORDS.test(text) ? [] : ["size or dimensions"]),
    ...(MATERIAL_WORDS.test(text) ? [] : ["material"]),
    ...(USE_WORDS.test(text) ? [] : ["use or care"]),
  ];
  if (missing.length) {
    reasons.push({
      code: "missing_details",
      severity: missing.length === 3 ? "medium" : "low",
      evidence: `Description doesn't mention ${missing.join(", ")}.`,
      data: { missing },
      link: "#page",
    });
  }
  if (p.descriptionWords >= MIN_WORDS_FOR_DUPLICATE) {
    const same = (ctx.descriptions.get(normalizeDescription(p.description)) ?? []).filter((id) => id !== p.id);
    if (same.length) {
      reasons.push({
        code: "duplicate_description",
        severity: "medium",
        evidence: `Description is identical to ${same.length} other product${same.length === 1 ? "" : "s"}.`,
        data: { sameAs: same.slice(0, 10), count: same.length },
        link: "#page",
      });
    }
  }

  // 4. Missing SEO title or meta description.
  const seoMissing = [...(p.seoTitle ? [] : ["SEO title"]), ...(p.seoDescription ? [] : ["meta description"])];
  if (seoMissing.length) {
    reasons.push({
      code: "missing_seo",
      severity: "low",
      evidence: `Missing ${seoMissing.join(" and ")}.`,
      data: { missing: seoMissing },
      link: "#page",
    });
  }

  // 5. Broken size run: some variants out of stock while others still have stock.
  if (p.variants.length > 1) {
    const out = p.variants.filter((v) => v.stock <= 0);
    if (out.length > 0 && out.length < p.variants.length) {
      reasons.push({
        code: "broken_size_run",
        severity: out.length / p.variants.length >= 1 / 3 ? "high" : "medium",
        evidence: `${out.length} of ${p.variants.length} variants are out of stock: ${out.slice(0, 5).map((v) => v.title).join(", ")}${out.length > 5 ? "…" : ""}.`,
        data: { outOfStock: out.map((v) => v.title), variants: p.variants.length },
        link: "#variants",
      });
    }
  }

  // 6. Not in any collection, or only in low-traffic collections (bottom quarter by views).
  if (p.collections.length === 0) {
    reasons.push({ code: "no_collection", severity: "high", evidence: "Not in any collection, so shoppers can't browse to it.", data: {}, link: "#overview" });
  } else if (ctx.collectionViews.size >= 4) {
    const all = [...ctx.collectionViews.values()].sort((a, b) => a - b);
    const lowCut = all[Math.floor((all.length - 1) * 0.25)];
    const own = p.collections.map((c) => ctx.collectionViews.get(c) ?? 0);
    if (own.every((v) => v <= lowCut)) {
      reasons.push({
        code: "low_traffic_collections",
        severity: "medium",
        evidence: `Only in collections with little traffic (at most ${Math.max(...own)} views in 30 days; the bottom quarter of the store is ${lowCut} or less).`,
        data: { collectionViews: own, lowCut },
        link: "#overview",
      });
    }
  }

  // 7. Many add to cart but few buy → likely store-level (shipping cost, checkout), not this product.
  if (p.views30 >= ctx.minViews && p.carts30 > 0 && ctx.medianViewToCart != null && ctx.medianCartToPurchase != null) {
    const viewToCart = p.carts30 / p.views30;
    const cartToPurchase = p.purchases30 / p.carts30;
    if (viewToCart >= ctx.medianViewToCart && cartToPurchase < ctx.medianCartToPurchase * 0.5) {
      reasons.push({
        code: "store_checkout_issue",
        severity: "medium",
        evidence: `${pct(viewToCart)} of viewers add it to the cart (store median ${pct(ctx.medianViewToCart)}), but only ${pct(cartToPurchase)} of carts buy (store median ${pct(ctx.medianCartToPurchase)}). Check shipping costs and checkout.`,
        data: { viewToCart, cartToPurchase, medianViewToCart: ctx.medianViewToCart, medianCartToPurchase: ctx.medianCartToPurchase },
        link: "#metrics",
      });
    }
  }

  return reasons.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
