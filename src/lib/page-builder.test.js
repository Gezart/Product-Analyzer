import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blockEnabled,
  boughtTogether,
  boughtTogetherChanges,
  DEFAULT_PAGE_BUILDER,
  lowStockText,
  pageBuilderOf,
  storefrontConfig,
  validatePageBuilder,
} from "./page-builder.js";

const P = (n) => `gid://shopify/Product/${n}`;
const C = (n) => `gid://shopify/Collection/${n}`;
const withBlock = (type, change) => ({
  blocks: DEFAULT_PAGE_BUILDER.blocks.map((b) => (b.type === type ? { ...b, ...change, settings: { ...b.settings, ...change.settings } } : b)),
});
const errorsOf = (body) => validatePageBuilder(body).errors?.map((e) => `${e.field}: ${e.message}`) ?? [];

test("the defaults are valid and show nothing", () => {
  assert.deepEqual(validatePageBuilder(DEFAULT_PAGE_BUILDER), { ok: true, value: DEFAULT_PAGE_BUILDER });
  assert.deepEqual(storefrontConfig(DEFAULT_PAGE_BUILDER, { included: true }), { v: 1, blocks: [] });
});

test("every block type exactly once, in the merchant's order", () => {
  const reversed = { blocks: [...DEFAULT_PAGE_BUILDER.blocks].reverse() };
  assert.deepEqual(validatePageBuilder(reversed).value.blocks.map((b) => b.type), ["bought_together", "size_chart", "trust_badges", "low_stock"]);

  const duplicated = { blocks: [...DEFAULT_PAGE_BUILDER.blocks.slice(0, 3), DEFAULT_PAGE_BUILDER.blocks[0]] };
  assert.deepEqual(errorsOf(duplicated), ["blocks: The blocks aren't valid."]);
  assert.deepEqual(errorsOf({ blocks: DEFAULT_PAGE_BUILDER.blocks.slice(1) }), ["blocks: The blocks aren't valid."]);
  assert.deepEqual(errorsOf(null), ["blocks: The blocks aren't valid."]);
});

test("block settings are checked", () => {
  assert.deepEqual(errorsOf(withBlock("low_stock", { settings: { threshold: 0 } })), ["low_stock: Show it at 1 to 50 left."]);
  assert.deepEqual(errorsOf(withBlock("low_stock", { settings: { text: "Hurry up" } })), ["low_stock: The text needs {count} (up to 80 characters)."]);
  assert.deepEqual(errorsOf(withBlock("trust_badges", { settings: { items: [] } })), ["trust_badges: Add 1 to 4 badges."]);
  assert.deepEqual(errorsOf(withBlock("trust_badges", { settings: { items: [{ icon: "rocket", text: "Fast" }] } })), ["trust_badges: Pick an icon for every badge."]);
  assert.deepEqual(errorsOf(withBlock("size_chart", { settings: { rows: [["Size", "Chest"], ["S"]] } })), ["size_chart: Every row needs 2 cells of up to 24 characters."]);
  assert.deepEqual(errorsOf(withBlock("size_chart", { settings: { rows: [["Size", ""], ["S", "90"]] } })), ["size_chart: Every column needs a heading."]);
  assert.deepEqual(errorsOf(withBlock("bought_together", { settings: { max: 5 } })), ["bought_together: Show 1 to 4 products."]);
  assert.deepEqual(errorsOf(withBlock("bought_together", { enabled: "yes" })), ["bought_together: On or off is missing."]);
});

test("texts are trimmed", () => {
  const r = validatePageBuilder(withBlock("trust_badges", { settings: { items: [{ icon: "secure", text: "  Safe  " }] } }));
  assert.deepEqual(r.value.blocks[1].settings.items, [{ icon: "secure", text: "Safe" }]);
});

test("\"Use for\": all, collections or products, with at least one picked", () => {
  const collections = validatePageBuilder(withBlock("size_chart", { useFor: { mode: "collections", collectionIds: [C(1), C(1)], productIds: [P(9)] } }));
  assert.deepEqual(collections.value.blocks[2].useFor, { mode: "collections", collectionIds: [C(1)], productIds: [] });

  assert.deepEqual(errorsOf(withBlock("size_chart", { useFor: { mode: "collections", collectionIds: [] } })), ["size_chart: Pick at least one collection."]);
  assert.deepEqual(errorsOf(withBlock("size_chart", { useFor: { mode: "products", productIds: [C(1)] } })), ["size_chart: The products aren't valid."]);
  assert.deepEqual(errorsOf(withBlock("size_chart", { useFor: { mode: "some" } })), ["size_chart: Choose where the block is used."]);
});

test("a malformed stored page builder reads back as the defaults", () => {
  assert.deepEqual(pageBuilderOf({}), DEFAULT_PAGE_BUILDER);
  assert.deepEqual(pageBuilderOf(null), DEFAULT_PAGE_BUILDER);
});

test("the storefront gets the blocks that are on, in order, with numeric ids", () => {
  const builder = {
    blocks: [
      { ...DEFAULT_PAGE_BUILDER.blocks[3], enabled: true },
      { ...DEFAULT_PAGE_BUILDER.blocks[2], enabled: true, useFor: { mode: "collections", collectionIds: [C(12)], productIds: [] } },
      DEFAULT_PAGE_BUILDER.blocks[0],
      { ...DEFAULT_PAGE_BUILDER.blocks[1], enabled: true, useFor: { mode: "products", collectionIds: [], productIds: [P(7)] } },
    ],
  };
  const config = storefrontConfig(builder, { included: true });
  assert.deepEqual(config.blocks.map((b) => [b.type, b.for]), [
    ["bought_together", { mode: "all", ids: [] }],
    ["size_chart", { mode: "collections", ids: [12] }],
    ["trust_badges", { mode: "products", ids: [7] }],
  ]);
  assert.equal(config.blocks[0].title, "Often bought together");
  assert.equal(config.blocks[0].max, 3);

  // Off the plan: nothing shows, whatever is set.
  assert.deepEqual(storefrontConfig(builder, { included: false }).blocks, []);
  assert.equal(blockEnabled(builder, "bought_together"), true);
  assert.equal(blockEnabled(builder, "low_stock"), false);
});

test("the low stock text gets its count", () => {
  assert.equal(lowStockText("Only {count} left, {count}!", 3), "Only 3 left, 3!");
});

test("often bought together: shared orders, most first, eligible products only", () => {
  const lines = [
    { orderGid: "o1", productGid: P(1) },
    { orderGid: "o1", productGid: P(2) },
    { orderGid: "o1", productGid: P(3) },
    { orderGid: "o2", productGid: P(1) },
    { orderGid: "o2", productGid: P(2) },
    { orderGid: "o2", productGid: P(2) }, // two lines of one product count once per order
    { orderGid: "o3", productGid: P(1) },
    { orderGid: "o3", productGid: P(3) },
    { orderGid: "o4", productGid: P(1) },
    { orderGid: "o4", productGid: P(4) }, // only once together: not enough
    { orderGid: "o5", productGid: P(5) },
  ];
  const eligible = new Set([P(1), P(2), P(3), P(4), P(5)]);
  const result = boughtTogether(lines, eligible);
  assert.deepEqual(result.get(P(1)), [P(2), P(3)]);
  assert.deepEqual(result.get(P(2)), [P(1)]);
  assert.deepEqual(result.get(P(3)), [P(1)]);
  assert.equal(result.has(P(4)), false);
  assert.equal(result.has(P(5)), false);

  // Archived or deleted products aren't suggested; `max` caps the list.
  assert.deepEqual(boughtTogether(lines, new Set([P(1), P(3)])).get(P(1)), [P(3)]);
  assert.deepEqual(boughtTogether(lines, eligible, { max: 1 }).get(P(1)), [P(2)]);
});

test("only changed lists are written; lists that are gone are cleared", () => {
  const current = new Map([
    [P(1), [P(2)]],
    [P(2), [P(1)]],
    [P(3), [P(1)]],
  ]);
  const next = new Map([
    [P(1), [P(2)]],
    [P(2), [P(3), P(1)]],
    [P(4), [P(1)]],
  ]);
  assert.deepEqual(boughtTogetherChanges(current, next), {
    set: [
      { product: P(2), list: [P(3), P(1)] },
      { product: P(4), list: [P(1)] },
    ],
    clear: [P(3)],
  });
});
