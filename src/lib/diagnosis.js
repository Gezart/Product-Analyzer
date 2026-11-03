// Rule-based diagnosis — docs/PLAN.md → "Diagnosis rules (v1)". Rules find the problem; every reason
// carries its evidence (the numbers that triggered it) and the page section that shows them.
// Pure (no imports) so node:test can load it. AI explanations are v2.

const PRICE_ABOVE = 0.25;
/** Above the market price: flagged above the merchant's threshold (default 10%), high above 25%. */
const MARKET_ABOVE = 0.1;
const MARKET_HIGH = 0.25;
const MIN_PEERS = 3;
export const MIN_IMAGES = 3;
export const MIN_WORDS = 80;
const MIN_CARTS = 5;
/** A collection holding more than this share of the store (e.g. "All", "Sale") isn't a price peer group. */
const BROAD_COLLECTION = 0.5;

export const SIZE_WORDS = /\b(size|sizes|sizing|fit|fits|dimensions?|cm|mm|inch|inches|length|width|height|weight|kg|ml|oz|xs|xl)\b/i;
export const MATERIAL_WORDS = /\b(material|materials|made of|made from|fabric|cotton|wool|linen|silk|leather|polyester|nylon|steel|wood|wooden|glass|ceramic|plastic|metal|gold|silver)\b/i;
export const USE_WORDS = /\b(use|uses|care|wash|washable|how to|ideal for|perfect for|suitable for|great for|designed for)\b/i;

export function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * How far `price` is above (positive) or below (negative) `market`, as a share rounded to 4 decimals (so
 * 55 vs 50 is exactly 10% wherever it is shown or compared); null without a market price.
 */
export function gapToMarket(price, market) {
  if (!(market > 0) || !(price > 0)) return null;
  return Math.round((price / market - 1) * 10000) / 10000;
}

const pct = (n) => `${Math.round(n * 100)}%`;
const count = (n) => n.toLocaleString("en-US");
/** A price in the store's currency when it's known, else with two decimals. */
function money(n, currency) {
  try {
    if (currency) return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {}
  return n.toFixed(2);
}
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

/** Returned often: at least this many units came back, at twice the store's return rate (three times: high). */
export const MIN_RETURNED = 5;
const RETURNS_FACTOR = 2;
const RETURNS_HIGH_FACTOR = 3;

/** A return rate for people: whole percents from 10%, one decimal below ("0.3%", "4.5%"). */
export function returnPct(rate) {
  const p = rate * 100;
  return p >= 10 ? `${Math.round(p)}%` : `${Math.round(p * 10) / 10}%`;
}

/** Hints the page can't act on (supplier, fulfillment, carrier) aren't shown under a page editor. */
export function returnHintType(handle) {
  return /damage|defect|quality|broken|wrong|late|delay/.test(String(handle ?? "").toLowerCase()) ? "other" : "description";
}

/** What to change for the most common return reason (Shopify's reason handle), or null for a general hint. */
export function returnHint(handle) {
  const h = String(handle ?? "").toLowerCase();
  if (/small|big|large|tight|loose|fit|size|long|short|comfort/.test(h)) return "Add a size chart and fit notes (runs small or large, model's size) to the description.";
  if (/colou?r|style|described|looks|different|picture|photo/.test(h)) return "Show it as it really is: true-color photos and an exact description of material and finish.";
  if (/damage|defect|quality|broken/.test(h)) return "Check quality and packaging with your supplier: the page can't fix these returns.";
  if (/wrong/.test(h)) return "Check picking and labels in fulfillment: customers got the wrong item.";
  if (/late|delay/.test(h)) return "Check the delivery times the page promises and your carrier.";
  return null;
}

/** Peer median excluding the product itself, so one expensive product can't hide behind its own price. */
function peerMedian(prices, own, ownIsListed) {
  if (!prices) return null;
  const others = [...prices];
  const i = ownIsListed ? others.indexOf(own) : -1;
  if (i >= 0) others.splice(i, 1);
  const m = median(others);
  return m != null && others.length >= MIN_PEERS && m > 0 ? { median: m, count: others.length } : null;
}

/** `ctx`: store-wide numbers the rules compare against (built once per shop). */
export function diagnose(p, ctx) {
  const reasons = [];

  // 1. Price more than 25% above the median of similar products: the narrowest group with enough
  //    peers. A product with a type is only compared with products of the same type (its type, or its
  //    type within one of its collections), so a coat is never compared with socks; a product without
  //    a type falls back to its collections. Catch-all groups (over half the store, e.g. one type for
  //    everything or an "All" collection) aren't similar products and are skipped. A product that
  //    sells well isn't flagged for its price.
  const isSpecific = (prices) => prices.length <= Math.max(MIN_PEERS + 1, ctx.activeProducts * BROAD_COLLECTION);
  const candidates = (
    p.sellingWell
      ? []
      : p.productType
        ? [
            { label: `product type "${p.productType}"`, key: p.productType, prices: ctx.pricesByType.get(p.productType) },
            ...p.collections.map((c) => ({
              label: `"${p.productType}" products in the same collection`,
              key: `${c}|${p.productType}`,
              prices: ctx.pricesByCollectionType?.get(`${c}|${p.productType}`),
            })),
          ]
        : p.collections.map((c) => ({ label: "its collection", key: c, prices: ctx.pricesByCollection.get(c) }))
  )
    .filter((g) => Boolean(g.prices && isSpecific(g.prices)))
    .sort((a, b) => a.prices.length - b.prices.length);
  const group = candidates
    .map((g) => ({ label: g.label, key: g.key, peers: peerMedian(g.prices, p.price, p.active) }))
    .find((g) => g.peers != null);
  const above = group ? p.price / group.peers.median - 1 : 0;
  if (group && above > PRICE_ABOVE) {
    reasons.push({
      code: "price_above_peers",
      severity: above > 0.5 ? "high" : "medium",
      evidence: `Price is ${pct(above)} above the median ${money(group.peers.median, ctx.currency)} of ${group.peers.count} other products in ${group.label}.`,
      data: { price: p.price, peerMedian: group.peers.median, peers: group.peers.count, group: group.key, abovePct: above },
      link: "#overview",
    });
  }

  // 1b. Price above the market price, in the shop's currency only (`p.market`, built by the caller): the
  //     median of the competitor links the merchant added, or else Google's benchmark price for the same
  //     product. Like rule 1, not for a product that sells well.
  const marketAbove = ctx.marketAbove ?? MARKET_ABOVE;
  if (p.market?.median > 0 && p.price > 0 && !p.sellingWell) {
    const gap = gapToMarket(p.price, p.market.median);
    if (gap > marketAbove) {
      const n = p.market.count;
      const where =
        p.market.source === "google"
          ? `Google's benchmark: what shoppers pay on average for this product on Google${p.market.country ? ` in ${p.market.country}` : ""}`
          : `the median of ${n} competitor price${n === 1 ? "" : "s"} you added`;
      reasons.push({
        code: "price_above_market",
        severity: gap > Math.max(MARKET_HIGH, marketAbove) ? "high" : "medium",
        evidence: `Price is ${pct(gap)} above the market price ${money(p.market.median, ctx.currency)} (${where}).`,
        data: { price: p.price, marketMedian: p.market.median, prices: n, source: p.market.source ?? "competitors", abovePct: gap, threshold: marketAbove },
        link: "#market",
      });
    }
  }

  // 2. Fewer than 3 images.
  if (p.imageCount < MIN_IMAGES) {
    reasons.push({
      code: "few_images",
      severity: p.imageCount === 0 ? "high" : "medium",
      evidence: p.imageCount === 0 ? `No images (at least ${MIN_IMAGES} recommended).` : `Only ${p.imageCount} image${p.imageCount === 1 ? "" : "s"} (at least ${MIN_IMAGES} recommended).`,
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
  if (p.pageDataKnown) {
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
    const same = [...(p.duplicateOf ?? [])].filter((id) => id !== p.id).sort();
    if (same.length) {
      reasons.push({
        code: "duplicate_description",
        severity: "medium",
        evidence: `Description is identical to ${same.length} other product${same.length === 1 ? "" : "s"}.`,
        data: { sameAs: same.slice(0, 10), count: same.length },
        link: "#page",
      });
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
  }

  // 5. Broken size run: some variants out of stock while others still have stock.
  if (p.variants.length > 1) {
    const out = p.variants.filter((v) => v.stock <= 0 && !v.sellsWhenOut);
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
        evidence: `Only in collections with little traffic (at most ${count(Math.max(...own))} views in 30 days; the bottom quarter of the store is ${count(lowCut)} or less).`,
        data: { collectionViews: own, lowCut },
        link: "#overview",
      });
    }
  }

  // 7b. Returned often: at least 5 units came back and the return rate is at least twice the store's
  //    (`p.returns` and `ctx.storeReturnRate` over the same recent days, built by the caller).
  const ret = p.returns;
  // How many times the store's rate, rounded so exactly 2× or 3× counts (0.1 × 3 is 0.30000000000000004).
  const times = ret && ctx.storeReturnRate > 0 ? Math.round((ret.rate / ctx.storeReturnRate) * 1e6) / 1e6 : 0;
  if (ret && ret.returned >= MIN_RETURNED && times >= RETURNS_FACTOR) {
    const top = ret.topReason;
    reasons.push({
      code: "returned_often",
      severity: times >= RETURNS_HIGH_FACTOR ? "high" : "medium",
      evidence:
        `${returnPct(ret.rate)} of the units sold in the last ${ret.days} days came back (${ret.returned} of ${ret.sold}); the store's average is ${returnPct(ctx.storeReturnRate)}.` +
        (top ? ` Most common reason: ${top.name} (${top.count}).` : ""),
      data: {
        returned: ret.returned,
        sold: ret.sold,
        rate: ret.rate,
        storeRate: ctx.storeReturnRate,
        topReason: top?.handle ?? null,
        hint: returnHint(top?.handle),
        hintType: returnHintType(top?.handle),
      },
      link: "#returns",
    });
  }

  // 7. Many add to cart but few buy → likely store-level (shipping cost, checkout), not this product.
  if (p.views30 >= ctx.minViews && p.carts30 >= MIN_CARTS && ctx.medianViewToCart != null && ctx.medianCartToPurchase != null) {
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

/**
 * What makes two diagnoses "the same": the reasons and the items they name, not the rolling numbers
 * (medians and percentages move every day as the 30-day window rolls).
 */
export function reasonSignature(reasons) {
  return reasons
    .map((r) => {
      const items = ["outOfStock", "missing", "sameAs", "group", "source", "topReason"]
        .map((k) => r.data[k])
        .filter((v) => v != null)
        .map((v) => (Array.isArray(v) ? [...v].sort().join("|") : String(v)));
      return [r.code, r.severity, ...items].join(":");
    })
    .sort()
    .join(";");
}
