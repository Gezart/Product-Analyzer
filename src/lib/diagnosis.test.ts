import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnose, median, reasonSignature, type DiagnosisContext, type DiagnosisProduct } from "./diagnosis.ts";

const GOOD_TEXT =
  "Soft cotton shirt made from organic fabric. Sizes from XS to XL with a relaxed fit. Machine wash cold, ideal for everyday use. " +
  "word ".repeat(70);

function product(o: Partial<DiagnosisProduct> = {}): DiagnosisProduct {
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

function ctx(o: Partial<DiagnosisContext> = {}): DiagnosisContext {
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

const codes = (p: DiagnosisProduct, c: DiagnosisContext) => diagnose(p, c).map((r) => r.code);

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
  // The collection (4 products) is narrower than the type (5), so it is the peer group.
  assert.match(r.evidence, /33% above the median 30\.00 of 3 other products in its collection/);
  assert.equal(r.data.peerMedian, 30);
  assert.equal(r.link, "#overview");
  // 25% or less is fine; too few peers says nothing.
  assert.deepEqual(codes(product({ price: 37.5 }), ctx()), []);
  assert.deepEqual(codes(product({ price: 90 }), ctx({ pricesByType: new Map([["Shirts", [90, 30, 30]]]), pricesByCollection: new Map() })), []);
});

test("few images, short or thin description, missing SEO", () => {
  const c = codes(product({ price: 30, imageCount: 1, description: "Nice shirt", descriptionWords: 2, seoTitle: null }), ctx());
  assert.ok(c.includes("few_images") && c.includes("short_description") && c.includes("missing_details") && c.includes("missing_seo"));
  const details = diagnose(product({ price: 30, description: "word ".repeat(90) }), ctx()).find((r) => r.code === "missing_details")!;
  assert.deepEqual(details.data.missing, ["size or dimensions", "material", "use or care"]);
});

test("duplicate description across products, listed in a stable order", () => {
  const r = diagnose(product({ price: 30, duplicateOf: ["p3", "p2"] }), ctx()).find((x) => x.code === "duplicate_description")!;
  assert.equal(r.data.count, 2);
  assert.deepEqual(r.data.sameAs, ["p2", "p3"]);
});

test("rows synced before the text was stored don't get description or SEO reasons", () => {
  const c = codes(product({ price: 30, description: null, seoTitle: null, seoDescription: null, pageDataKnown: false, duplicateOf: null }), ctx());
  assert.deepEqual(c, []);
});

test("broken size run, but not when everything or nothing is out", () => {
  const v = (title: string, stock: number, sellsWhenOut = false) => ({ title, stock, sellsWhenOut });
  const r = diagnose(product({ price: 30, variants: [v("S", 0), v("M", 5), v("L", 2)] }), ctx());
  const run = r.find((x) => x.code === "broken_size_run")!;
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
  const r = diagnose(product({ price: 30, views30: 200, carts30: 30, purchases30: 3 }), c).find((x) => x.code === "store_checkout_issue")!;
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
  const r = diagnose(product({ price: 60, productType: null, collections: ["all", "tees"] }), c2).find((x) => x.code === "price_above_peers")!;
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
  const r = diagnose(product({ active: false, price: 30 * 1.5 }), c).find((x) => x.code === "price_above_peers")!;
  assert.equal(r.data.peers, 3);
});

test("signature ignores rolling numbers but not the items named", () => {
  const base = diagnose(product({ price: 40 }), ctx());
  const moved = diagnose(product({ price: 41 }), ctx());
  assert.equal(reasonSignature(base), reasonSignature(moved));
  const v = (title: string, stock: number) => ({ title, stock, sellsWhenOut: false });
  const a = diagnose(product({ price: 30, variants: [v("S", 0), v("M", 3), v("L", 3)] }), ctx());
  const b = diagnose(product({ price: 30, variants: [v("S", 3), v("M", 0), v("L", 3)] }), ctx());
  assert.notEqual(reasonSignature(a), reasonSignature(b));
});
