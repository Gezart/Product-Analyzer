import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleProducts, createJsonlParser, orderLinesFromBulk, orderLinesFromWebhook, rowsFromProductNode, wordCount } from "./transform.ts";

test("word count ignores extra whitespace", () => {
  assert.equal(wordCount("  Soft  cotton\nshirt "), 3);
  assert.equal(wordCount(null), 0);
});

test("products are assembled from parent and child rows in any order", () => {
  const rows = [
    { id: "gid://shopify/ProductVariant/11", price: "30.00", compareAtPrice: "40.00", sku: "S", inventoryQuantity: 5, selectedOptions: [{ name: "Size", value: "S" }], inventoryItem: { unitCost: { amount: "12.50" } }, __parentId: "gid://shopify/Product/1" },
    { id: "gid://shopify/Product/1", title: "Shirt", handle: "shirt", productType: "Tops", vendor: "Acme", status: "ACTIVE", createdAt: "2026-01-02T03:04:05Z", description: "Soft cotton shirt", seo: { title: "Shirt SEO", description: null }, mediaCount: { count: 4 } },
    { id: "gid://shopify/Collection/7", __parentId: "gid://shopify/Product/1" },
    { id: "gid://shopify/ProductVariant/12", price: "25.00", compareAtPrice: null, sku: "", inventoryQuantity: -2, inventoryPolicy: "CONTINUE", selectedOptions: [{ name: "Size", value: "M" }], inventoryItem: { unitCost: null, tracked: true }, __parentId: "gid://shopify/Product/1" },
    { id: "gid://shopify/Product/2", title: "Empty", handle: "empty", status: "DRAFT" },
  ];
  const [shirt, empty] = assembleProducts(rows);
  assert.equal(shirt.title, "Shirt");
  assert.equal(shirt.descriptionWords, 3);
  assert.equal(shirt.description, "Soft cotton shirt");
  assert.equal(shirt.seoTitle, "Shirt SEO");
  assert.equal(shirt.seoDescription, null);
  assert.equal(shirt.imageCount, 4);
  assert.deepEqual(shirt.collections, ["gid://shopify/Collection/7"]);
  assert.equal(shirt.price, 25);
  assert.equal(shirt.compareAtPrice, null);
  assert.deepEqual(shirt.createdAt, new Date("2026-01-02T03:04:05Z"));
  assert.deepEqual(shirt.variants[0], { gid: "gid://shopify/ProductVariant/11", sku: "S", options: { Size: "S" }, price: 30, cost: 12.5, inventoryQty: 5, sellsWhenOut: false });
  assert.equal(shirt.variants[1].cost, null);
  assert.equal(shirt.variants[1].sku, null);
  assert.equal(shirt.variants[1].inventoryQty, -2);
  assert.equal(shirt.variants[1].sellsWhenOut, true);
  assert.equal(empty.status, "DRAFT");
  assert.equal(empty.price, 0);
  assert.deepEqual(empty.variants, []);
});

test("bulk orders become lines per local day; cancelled kept at 0; deleted products skipped", () => {
  const rows = [
    { id: "gid://shopify/Order/1", createdAt: "2026-10-24T22:30:00Z", updatedAt: "2026-10-25T08:00:00Z" },
    { id: "gid://shopify/LineItem/1", currentQuantity: 2, product: { id: "gid://shopify/Product/1" }, variant: { id: "gid://shopify/ProductVariant/9" }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "25.00" } }, __parentId: "gid://shopify/Order/1" },
    { id: "gid://shopify/LineItem/2", currentQuantity: 1, product: null, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "9.00" } }, __parentId: "gid://shopify/Order/1" },
    { id: "gid://shopify/Order/2", createdAt: "2026-10-24T11:00:00Z", cancelledAt: "2026-10-24T12:00:00Z" },
    { id: "gid://shopify/LineItem/3", currentQuantity: 5, product: { id: "gid://shopify/Product/1" }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "20.00" } }, __parentId: "gid://shopify/Order/2" },
  ];
  const lines = orderLinesFromBulk(rows, "Europe/Tirane");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], {
    lineGid: "gid://shopify/LineItem/1", orderGid: "gid://shopify/Order/1", productGid: "gid://shopify/Product/1",
    variantGid: "gid://shopify/ProductVariant/9", date: "2026-10-25", quantity: 2, revenue: 50,
    orderUpdatedAt: new Date("2026-10-25T08:00:00Z"),
  });
  assert.equal(lines[1].quantity, 0);
  assert.equal(lines[1].revenue, 0);
  assert.equal(lines[1].date, "2026-10-24");
});

test("webhook orders use the same rules; order-level discounts and partial refunds reduce revenue", () => {
  const order = {
    admin_graphql_api_id: "gid://shopify/Order/5",
    created_at: "2026-10-24T10:00:00+02:00",
    updated_at: "2026-10-24T12:00:00+02:00",
    cancelled_at: null,
    line_items: [
      // 3 × 10 = 30, 6 of discounts → 24; one unit refunded → 2/3 of it = 16.
      { admin_graphql_api_id: "gid://shopify/LineItem/8", product_id: 1, variant_id: 9, quantity: 3, current_quantity: 2, price: "10.00", discount_allocations: [{ amount: "4.00" }, { amount: "2.00" }] },
      { admin_graphql_api_id: "gid://shopify/LineItem/9", product_id: null, quantity: 1, price: "5.00" },
    ],
  };
  const [line, ...rest] = orderLinesFromWebhook(order, "UTC");
  assert.deepEqual(rest, []);
  assert.equal(line.productGid, "gid://shopify/Product/1");
  assert.equal(line.variantGid, "gid://shopify/ProductVariant/9");
  assert.equal(line.date, "2026-10-24");
  assert.equal(line.quantity, 2);
  assert.equal(line.revenue, 16);
  const cancelled = orderLinesFromWebhook({ ...order, cancelled_at: "2026-10-24T13:00:00+02:00" }, "UTC");
  assert.equal(cancelled[0].quantity, 0);
  assert.equal(cancelled[0].revenue, 0);
});

test("refunded/removed line items (current quantity 0) count as 0", () => {
  const rows = [
    { id: "gid://shopify/Order/1", createdAt: "2026-10-24T10:00:00Z" },
    { id: "gid://shopify/LineItem/1", currentQuantity: 0, product: { id: "gid://shopify/Product/1" }, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "10.00" } }, __parentId: "gid://shopify/Order/1" },
  ];
  assert.equal(orderLinesFromBulk(rows, "UTC")[0].quantity, 0);
});

test("single product node becomes bulk-shaped rows", () => {
  const rows = rowsFromProductNode({
    id: "gid://shopify/Product/1", title: "Shirt", handle: "shirt", status: "ACTIVE",
    collections: { nodes: [{ id: "gid://shopify/Collection/7" }] },
    variants: { nodes: [{ id: "gid://shopify/ProductVariant/11", price: "30.00", inventoryQuantity: 4 }] },
  });
  const [product] = assembleProducts(rows);
  assert.deepEqual(product.collections, ["gid://shopify/Collection/7"]);
  assert.equal(product.variants[0].inventoryQty, 4);
  assert.equal(product.price, 30);
});

test("JSONL parser handles lines split across chunks and a missing final newline", () => {
  const p = createJsonlParser();
  assert.deepEqual(p.push('{"id":1}\n{"id"'), [{ id: 1 }]);
  assert.deepEqual(p.push(':2}\n\n{"id":3}'), [{ id: 2 }]);
  assert.deepEqual(p.end(), [{ id: 3 }]);
});
