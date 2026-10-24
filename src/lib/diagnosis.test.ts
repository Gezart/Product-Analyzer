import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnose, median, normalizeDescription, type DiagnosisContext, type DiagnosisProduct } from "./diagnosis.ts";

const GOOD_TEXT =
  "Soft cotton shirt made from organic fabric. Sizes from XS to XL with a relaxed fit. Machine wash cold, ideal for everyday use. " +
  "word ".repeat(70);

function product(o: Partial<DiagnosisProduct> = {}): DiagnosisProduct {
  return {
    id: "p1",
    price: 40,
    productType: "Shirts",
    collections: ["c1"],
    imageCount: 5,
    description: GOOD_TEXT,
    descriptionWords: 90,
    seoTitle: "Shirt",
    seoDescription: "A shirt",
    variants: [{ title: "S", stock: 3 }, { title: "M", stock: 4 }],
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
    descriptions: new Map([[normalizeDescription(GOOD_TEXT), ["p1"]]]),
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
  const details = diagnose(product({ price: 30, description: "word ".repeat(90) }), ctx()).find((r) => r.code === "missing_details")!;
  assert.deepEqual(details.data.missing, ["size or dimensions", "material", "use or care"]);
});

test("duplicate description across products", () => {
  const c = ctx({ descriptions: new Map([[normalizeDescription(GOOD_TEXT), ["p1", "p2", "p3"]]]) });
  const r = diagnose(product({ price: 30 }), c).find((x) => x.code === "duplicate_description")!;
  assert.equal(r.data.count, 2);
});

test("broken size run, but not when everything or nothing is out", () => {
  const r = diagnose(product({ price: 30, variants: [{ title: "S", stock: 0 }, { title: "M", stock: 5 }, { title: "L", stock: 2 }] }), ctx());
  const run = r.find((x) => x.code === "broken_size_run")!;
  assert.deepEqual(run.data.outOfStock, ["S"]);
  assert.equal(run.link, "#variants");
  assert.ok(!codes(product({ price: 30, variants: [{ title: "S", stock: 0 }, { title: "M", stock: 0 }] }), ctx()).includes("broken_size_run"));
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
});

test("reasons are ordered by severity", () => {
  const r = diagnose(product({ price: 30, collections: [], seoTitle: null }), ctx());
  assert.deepEqual(r.map((x) => x.severity), ["high", "low"]);
});
