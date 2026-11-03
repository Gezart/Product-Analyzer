import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnose, median, reasonSignature } from "./diagnosis.js";

const GOOD_TEXT =
  "Soft cotton shirt made from organic fabric. Sizes from XS to XL with a relaxed fit. Machine wash cold, ideal for everyday use. " +
  "word ".repeat(70);

function product(o = {}) {
  return {
    id: "p1",
    active: true,
    price: 40,
    productType: "Shirts",
    collections: ["c1"],
    imageCount: 5,
    description: GOOD_TEXT,
    descriptionWords: 90,
    seoTitle: "Shirt",
    seoDescription: "A shirt",
    pageDataKnown: true,
    duplicateOf: [],
    variants: [{ title: "S", stock: 3, sellsWhenOut: false }, { title: "M", stock: 4, sellsWhenOut: false }],
    views30: 0,
    carts30: 0,
    purchases30: 0,
    ...o,
  };
}

function ctx(o = {}) {
  return {
    pricesByType: new Map([["Shirts", [40, 30, 30, 30, 30]]]),
    pricesByCollection: new Map([["c1", [40, 30, 30, 30]]]),
    activeProducts: 20,
    collectionViews: new Map(),
    medianViewToCart: null,
    medianCartToPurchase: null,
    minViews: 20,
    ...o,
  };
}

const codes = (p, c) => diagnose(p, c).map((r) => r.code);

test("a complete, fairly priced product has no reasons", () => {
  assert.deepEqual(codes(product({ price: 32 }), ctx()), []);
});

test("median", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("price more than 25% above peers, with the numbers as evidence", () => {
  const [r] = diagnose(product({ price: 40 }), ctx());
  assert.equal(r.code, "price_above_peers");
  // A typed product is compared with its type (or its type within a collection), never a mixed collection.
  assert.match(r.evidence, /33% above the median 30\.00 of 4 other products in product type "Shirts"/);
  assert.equal(r.data.peerMedian, 30);
  assert.equal(r.link, "#overview");
  // 25% or less is fine; too few peers says nothing.
  assert.deepEqual(codes(product({ price: 37.5 }), ctx()), []);
  assert.deepEqual(codes(product({ price: 90 }), ctx({ pricesByType: new Map([["Shirts", [90, 30, 30]]]), pricesByCollection: new Map() })), []);
});

test("few images, short or thin description, missing SEO", () => {
  const c = codes(product({ price: 30, imageCount: 1, description: "Nice shirt", descriptionWords: 2, seoTitle: null }), ctx());
  assert.ok(c.includes("few_images") && c.includes("short_description") && c.includes("missing_details") && c.includes("missing_seo"));
  const details = diagnose(product({ price: 30, description: "word ".repeat(90) }), ctx()).find((r) => r.code === "missing_details");
  assert.deepEqual(details.data.missing, ["size or dimensions", "material", "use or care"]);
});

test("duplicate description across products, listed in a stable order", () => {
  const r = diagnose(product({ price: 30, duplicateOf: ["p3", "p2"] }), ctx()).find((x) => x.code === "duplicate_description");
  assert.equal(r.data.count, 2);
  assert.deepEqual(r.data.sameAs, ["p2", "p3"]);
});

test("rows synced before the text was stored don't get description or SEO reasons", () => {
  const c = codes(product({ price: 30, description: null, seoTitle: null, seoDescription: null, pageDataKnown: false, duplicateOf: null }), ctx());
  assert.deepEqual(c, []);
});

test("broken size run, but not when everything or nothing is out", () => {
  const v = (title, stock, sellsWhenOut = false) => ({ title, stock, sellsWhenOut });
  const r = diagnose(product({ price: 30, variants: [v("S", 0), v("M", 5), v("L", 2)] }), ctx());
  const run = r.find((x) => x.code === "broken_size_run");
  assert.deepEqual(run.data.outOfStock, ["S"]);
  assert.equal(run.link, "#variants");
  assert.ok(!codes(product({ price: 30, variants: [v("S", 0), v("M", 0)] }), ctx()).includes("broken_size_run"));
  // Still buyable at 0 (untracked or "continue selling"): not out of stock.
  assert.ok(!codes(product({ price: 30, variants: [v("S", 0, true), v("M", 5)] }), ctx()).includes("broken_size_run"));
});

test("no collection; low-traffic collections need view data", () => {
  assert.ok(codes(product({ price: 30, collections: [] }), ctx()).includes("no_collection"));
  const views = new Map([["c1", 5], ["c2", 500], ["c3", 800], ["c4", 900]]);
  assert.ok(codes(product({ price: 30 }), ctx({ collectionViews: views })).includes("low_traffic_collections"));
  assert.ok(!codes(product({ price: 30, collections: ["c1", "c3"] }), ctx({ collectionViews: views })).includes("low_traffic_collections"));
});

test("high add-to-cart but low purchase flags a store-level issue", () => {
  const c = ctx({ medianViewToCart: 0.08, medianCartToPurchase: 0.4 });
  const r = diagnose(product({ price: 30, views30: 200, carts30: 30, purchases30: 3 }), c).find((x) => x.code === "store_checkout_issue");
  assert.match(r.evidence, /15% of viewers add it to the cart/);
  assert.ok(!codes(product({ price: 30, views30: 200, carts30: 30, purchases30: 12 }), c).includes("store_checkout_issue"));
  assert.ok(!codes(product({ price: 30, views30: 10, carts30: 5, purchases30: 0 }), c).includes("store_checkout_issue"));
  // Too few carts to judge.
  assert.ok(!codes(product({ price: 30, views30: 20, carts30: 2, purchases30: 0 }), c).includes("store_checkout_issue"));
});

test("reasons are ordered by severity", () => {
  const r = diagnose(product({ price: 30, collections: [], seoTitle: null }), ctx());
  assert.deepEqual(r.map((x) => x.severity), ["high", "low"]);
});

test("catch-all collections aren't price peers; type peers come first", () => {
  // $200 jacket among $195–210 jackets, also in an "All" collection full of $30 tees.
  const all = [200, 195, 205, 210, 30, 30, 30, 30, 30, 30];
  const c = ctx({
    pricesByType: new Map([["Jackets", [200, 195, 205, 210]]]),
    pricesByCollection: new Map([["all", all]]),
    activeProducts: all.length,
  });
  assert.deepEqual(codes(product({ price: 200, productType: "Jackets", collections: ["all"] }), c), []);
  // No type: a specific collection is used, the catch-all isn't.
  const c2 = ctx({ pricesByType: new Map(), pricesByCollection: new Map([["all", all], ["tees", [30, 30, 30, 60]]]), activeProducts: all.length });
  const r = diagnose(product({ price: 60, productType: null, collections: ["all", "tees"] }), c2).find((x) => x.code === "price_above_peers");
  assert.equal(r.data.group, "tees");
});

test("a product type covering the whole store isn't a price peer group", () => {
  const all = [200, 30, 30, 30, 30, 30, 30, 30, 30, 30];
  const c = ctx({
    pricesByType: new Map([["Apparel", all]]),
    pricesByCollection: new Map([["jackets", [200, 195, 205, 210]]]),
    activeProducts: all.length,
  });
  assert.deepEqual(codes(product({ price: 200, productType: "Apparel", collections: ["jackets"] }), c), []);
});

test("draft products don't remove a real peer from the price list", () => {
  const c = ctx({ pricesByType: new Map([["Shirts", [30, 30, 30]]]), pricesByCollection: new Map() });
  const r = diagnose(product({ active: false, price: 30 * 1.5 }), c).find((x) => x.code === "price_above_peers");
  assert.equal(r.data.peers, 3);
});

test("signature ignores rolling numbers but not the items named", () => {
  const base = diagnose(product({ price: 40 }), ctx());
  const moved = diagnose(product({ price: 41 }), ctx());
  assert.equal(reasonSignature(base), reasonSignature(moved));
  const v = (title, stock) => ({ title, stock, sellsWhenOut: false });
  const a = diagnose(product({ price: 30, variants: [v("S", 0), v("M", 3), v("L", 3)] }), ctx());
  const b = diagnose(product({ price: 30, variants: [v("S", 3), v("M", 0), v("L", 3)] }), ctx());
  assert.notEqual(reasonSignature(a), reasonSignature(b));
});

test("price: same type only for typed products; collections for untyped; never for products selling well", () => {
  // The collection mixes types (a coat among socks): a typed coat without 3 coat peers gets no price reason.
  const mixed = ctx({ pricesByType: new Map([["Coats", [249]]]), pricesByCollection: new Map([["c1", [249, 10, 12, 14]]]) });
  assert.ok(!codes(product({ price: 249, productType: "Coats" }), mixed).includes("price_above_peers"));
  // Same type within a collection is a valid, narrower group.
  const typed = ctx({ pricesByType: new Map([["Coats", [249, 100, 100, 100, 100, 100]]]), pricesByCollectionType: new Map([["c1|Coats", [249, 90, 90, 90]]]) });
  assert.match(diagnose(product({ price: 249, productType: "Coats" }), typed).find((r) => r.code === "price_above_peers").evidence, /"Coats" products in the same collection/);
  // No type: its collection is the group.
  assert.ok(codes(product({ price: 40, productType: null }), ctx()).includes("price_above_peers"));
  // Selling well: no price reason; money shown in the store currency when known.
  assert.ok(!codes(product({ price: 40, sellingWell: true }), ctx()).includes("price_above_peers"));
  assert.match(diagnose(product({ price: 40 }), ctx({ currency: "EUR" }))[0].evidence, /median €30\.00/);
  assert.match(diagnose(product({ price: 30, imageCount: 0 }), ctx()).find((r) => r.code === "few_images").evidence, /^No images/);
});

// --- above the market price (competitor links) ---

const market = (median, count = 3) => ({ median, count, source: "competitors" });
const marketReason = (p, c = ctx()) => diagnose(p, c).find((r) => r.code === "price_above_market");

test("above the market: medium over 10%, high over 25%, with the market price as evidence", () => {
  const medium = marketReason(product({ price: 61.5, market: market(52) }), ctx({ currency: "EUR" }));
  assert.equal(medium.severity, "medium");
  assert.equal(medium.link, "#market");
  assert.equal(medium.evidence, "Price is 18% above the market price €52.00 (the median of 3 competitor prices you added).");
  assert.deepEqual(
    { ...medium.data, abovePct: Math.round(medium.data.abovePct * 1000) / 1000 },
    { price: 61.5, marketMedian: 52, prices: 3, source: "competitors", abovePct: 0.183, threshold: 0.1 },
  );
  assert.equal(marketReason(product({ price: 70, market: market(52, 1) })).severity, "high");
  assert.match(marketReason(product({ price: 70, market: market(52, 1) })).evidence, /median of 1 competitor price you added/);
});

test("above the market: not at or under the threshold, without a market price, or for a product that sells well", () => {
  assert.equal(marketReason(product({ price: 55, market: market(50) })), undefined); // exactly 10%
  assert.equal(marketReason(product({ price: 45, market: market(50) })), undefined);
  assert.equal(marketReason(product({ price: 70 })), undefined);
  assert.equal(marketReason(product({ price: 70, market: null })), undefined);
  assert.equal(marketReason(product({ price: 0, market: market(50) })), undefined);
  assert.equal(marketReason(product({ price: 70, market: market(50), sellingWell: true })), undefined);
});

test("above the market: the merchant's threshold; high stays at 25% unless the threshold is higher", () => {
  assert.equal(marketReason(product({ price: 54, market: market(50) }), ctx({ marketAbove: 0.05 })).severity, "medium");
  assert.equal(marketReason(product({ price: 58, market: market(50) }), ctx({ marketAbove: 0.2 })), undefined);
  assert.equal(marketReason(product({ price: 70, market: market(50) }), ctx({ marketAbove: 0.3 })).severity, "high");
  assert.equal(marketReason(product({ price: 64, market: market(50) }), ctx({ marketAbove: 0.3 })), undefined);
});

test("above the market and above the store's peers are separate reasons", () => {
  const reasons = codes(product({ price: 80, market: market(50) }), ctx());
  assert.ok(reasons.includes("price_above_market") && reasons.includes("price_above_peers"));
});

test("above the market: exactly 25% is medium; round prices exactly at the threshold aren't flagged", () => {
  assert.equal(marketReason(product({ price: 62.5, market: market(50) })).severity, "medium");
  assert.equal(marketReason(product({ price: 62.6, market: market(50) })).severity, "high");
  for (const [price, median] of [[22, 20], [33, 30], [110, 100], [27.5, 25]]) {
    assert.equal(marketReason(product({ price, market: market(median) })), undefined, `${price} vs ${median}`);
  }
});

test("above the market from Google's benchmark names Google and the country", () => {
  const r = marketReason(product({ price: 61.5, market: { median: 52, count: 1, country: "DE", source: "google" } }), ctx({ currency: "EUR" }));
  assert.equal(r.evidence, "Price is 18% above the market price €52.00 (Google's benchmark: what shoppers pay on average for this product on Google in DE).");
  assert.equal(r.data.source, "google");
});

// --- returned often ---

import { returnHint } from "./diagnosis.js";

const returnsOf = (returned, sold, topReason = null) => ({ returned, sold, rate: returned / sold, days: 90, topReason });
const returnsReason = (p, c = ctx({ storeReturnRate: 0.05 })) => diagnose(p, c).find((r) => r.code === "returned_often");

test("returned often: twice the store's rate with at least 5 units back; the most common reason and its hint", () => {
  const r = returnsReason(product({ returns: returnsOf(12, 66, { handle: "too-small", name: "Too Small", count: 7 }) }));
  assert.equal(r.severity, "high"); // 18% vs 5%: over three times
  assert.equal(r.link, "#returns");
  assert.equal(r.evidence, "18% of the units sold in the last 90 days came back (12 of 66); the store's average is 5%. Most common reason: Too Small (7).");
  assert.equal(r.data.topReason, "too-small");
  assert.match(r.data.hint, /size chart/);
  const medium = returnsReason(product({ returns: returnsOf(6, 50) }));
  assert.equal(medium.severity, "medium"); // 12%: over twice, under three times
  assert.equal(medium.data.hint, null);
  assert.doesNotMatch(medium.evidence, /Most common reason/);
});

test("returned often: not under twice the store's rate, not under 5 units back, not without a store rate", () => {
  assert.equal(returnsReason(product({ returns: returnsOf(9, 100) })), undefined); // 9% < 10%
  assert.equal(returnsReason(product({ returns: returnsOf(4, 10) })), undefined); // 40%, but only 4 back
  assert.equal(returnsReason(product({ returns: returnsOf(10, 50) }), ctx({ storeReturnRate: 0 })), undefined);
  assert.equal(returnsReason(product({})), undefined);
});

test("return hints by reason", () => {
  assert.match(returnHint("too-big"), /size chart/);
  assert.match(returnHint("color-too-bright"), /true-color photos/);
  assert.match(returnHint("not-as-described"), /true-color photos/);
  assert.match(returnHint("damaged"), /supplier/);
  assert.match(returnHint("wrong-item"), /fulfillment/);
  assert.match(returnHint("arrived-late"), /delivery times/);
  assert.equal(returnHint("unwanted"), null);
  assert.equal(returnHint(null), null);
});

import { returnHintType, returnPct } from "./diagnosis.js";

test("returned often: exactly twice is medium and exactly three times is high, despite float rounding", () => {
  assert.equal(returnsReason(product({ returns: { returned: 9, sold: 30, rate: 9 / 30, days: 90 } }), ctx({ storeReturnRate: 0.1 })).severity, "high");
  assert.equal(returnsReason(product({ returns: { returned: 6, sold: 20, rate: 6 / 20, days: 90 } }), ctx({ storeReturnRate: 1 / 10 })).severity, "high");
  assert.equal(returnsReason(product({ returns: { returned: 6, sold: 30, rate: 6 / 30, days: 90 } }), ctx({ storeReturnRate: 0.1 })).severity, "medium");
  assert.equal(returnsReason(product({ returns: { returned: 6, sold: 31, rate: 6 / 31, days: 90 } }), ctx({ storeReturnRate: 0.1 })), undefined);
});

test("small return rates keep a decimal, so the store's average never reads 0%", () => {
  assert.equal(returnPct(0.003), "0.3%");
  assert.equal(returnPct(0.045), "4.5%");
  assert.equal(returnPct(0.18), "18%");
  const r = returnsReason(product({ returns: { returned: 6, sold: 1000, rate: 0.006, days: 90 } }), ctx({ storeReturnRate: 0.003 }));
  assert.match(r.evidence, /^0\.6% of the units sold .* the store's average is 0\.3%\./);
});

test("hints the page can't act on go to the general hints", () => {
  assert.equal(returnHintType("too-small"), "description");
  assert.equal(returnHintType("color"), "description");
  assert.equal(returnHintType("damaged"), "other");
  assert.equal(returnHintType("wrong-item"), "other");
  assert.equal(returnHintType("arrived-late"), "other");
  // Text and place come from the same rule: a wrong size is a size hint, under the description.
  assert.match(returnHint("wrong-size"), /size chart/);
  assert.equal(returnHintType("wrong-size"), "description");
  assert.equal(returnPct(0.0004), "under 0.1%");
  assert.equal(returnPct(0), "0%");
});
