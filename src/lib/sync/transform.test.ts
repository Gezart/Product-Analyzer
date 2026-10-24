import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateOrders, assembleProducts, createJsonlParser, wordCount } from "./transform.ts";

test("word count ignores extra whitespace", () => {
  assert.equal(wordCount("  Soft  cotton\nshirt "), 3);
  assert.equal(wordCount(null), 0);
});

test("products are assembled from parent and child rows in any order", () => {
  const rows = [
    { id: "gid://shopify/ProductVariant/11", price: "30.00", compareAtPrice: "40.00", sku: "S", inventoryQuantity: 5, selectedOptions: [{ name: "Size", value: "S" }], inventoryItem: { unitCost: { amount: "12.50" } }, __parentId: "gid://shopify/Product/1" },
    { id: "gid://shopify/Product/1", title: "Shirt", handle: "shirt", productType: "Tops", vendor: "Acme", status: "ACTIVE", createdAt: "2026-01-02T03:04:05Z", description: "Soft cotton shirt", mediaCount: { count: 4 } },
    { id: "gid://shopify/Collection/7", __parentId: "gid://shopify/Product/1" },
    { id: "gid://shopify/ProductVariant/12", price: "25.00", compareAtPrice: null, sku: "", inventoryQuantity: -2, selectedOptions: [{ name: "Size", value: "M" }], inventoryItem: { unitCost: null }, __parentId: "gid://shopify/Product/1" },
    { id: "gid://shopify/Product/2", title: "Empty", handle: "empty", status: "DRAFT" },
  ];
  const [shirt, empty] = assembleProducts(rows);
  assert.equal(shirt.title, "Shirt");
  assert.equal(shirt.descriptionWords, 3);
  assert.equal(shirt.imageCount, 4);
  assert.deepEqual(shirt.collections, ["gid://shopify/Collection/7"]);
  assert.equal(shirt.price, 25);
  assert.equal(shirt.compareAtPrice, null);
  assert.deepEqual(shirt.createdAt, new Date("2026-01-02T03:04:05Z"));
  assert.deepEqual(shirt.variants[0], { gid: "gid://shopify/ProductVariant/11", sku: "S", options: { Size: "S" }, price: 30, cost: 12.5, inventoryQty: 5 });
  assert.equal(shirt.variants[1].cost, null);
  assert.equal(shirt.variants[1].sku, null);
  assert.equal(shirt.variants[1].inventoryQty, -2);
  assert.equal(empty.status, "DRAFT");
  assert.equal(empty.price, 0);
  assert.deepEqual(empty.variants, []);
});

test("orders aggregate per product per local day, skipping deleted products and cancelled orders", () => {
  const rows = [
    { id: "gid://shopify/Order/1", createdAt: "2026-10-24T22:30:00Z" },
    { id: "gid://shopify/LineItem/1", currentQuantity: 2, product: { id: "gid://shopify/Product/1" }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "25.00" } }, __parentId: "gid://shopify/Order/1" },
    { id: "gid://shopify/Order/2", createdAt: "2026-10-24T10:00:00Z" },
    { id: "gid://shopify/LineItem/2", currentQuantity: 1, product: { id: "gid://shopify/Product/1" }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "20.10" } }, __parentId: "gid://shopify/Order/2" },
    { id: "gid://shopify/LineItem/3", currentQuantity: 1, product: null, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "9.00" } }, __parentId: "gid://shopify/Order/2" },
    { id: "gid://shopify/Order/3", createdAt: "2026-10-24T11:00:00Z", cancelledAt: "2026-10-24T12:00:00Z" },
    { id: "gid://shopify/LineItem/4", currentQuantity: 5, product: { id: "gid://shopify/Product/1" }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "20.00" } }, __parentId: "gid://shopify/Order/3" },
  ];
  // UTC: both orders on 24 Oct. Tirana (UTC+2): order 1 falls on 25 Oct.
  assert.deepEqual(aggregateOrders(rows, "UTC"), [{ productGid: "gid://shopify/Product/1", date: "2026-10-24", units: 3, revenue: 70.1 }]);
  assert.deepEqual(
    aggregateOrders(rows, "Europe/Tirane").sort((a, b) => a.date.localeCompare(b.date)),
    [
      { productGid: "gid://shopify/Product/1", date: "2026-10-24", units: 1, revenue: 20.1 },
      { productGid: "gid://shopify/Product/1", date: "2026-10-25", units: 2, revenue: 50 },
    ],
  );
});

test("refunded/removed line items (current quantity 0) don't count", () => {
  const rows = [
    { id: "gid://shopify/Order/1", createdAt: "2026-10-24T10:00:00Z" },
    { id: "gid://shopify/LineItem/1", currentQuantity: 0, product: { id: "gid://shopify/Product/1" }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "10.00" } }, __parentId: "gid://shopify/Order/1" },
  ];
  assert.deepEqual(aggregateOrders(rows, "UTC"), []);
});

test("JSONL parser handles lines split across chunks and a missing final newline", () => {
  const p = createJsonlParser();
  assert.deepEqual(p.push('{"id":1}\n{"id"'), [{ id: 1 }]);
  assert.deepEqual(p.push(':2}\n\n{"id":3}'), [{ id: 2 }]);
  assert.deepEqual(p.end(), [{ id: 3 }]);
});
