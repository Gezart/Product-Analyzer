import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blockEnabled,
  boughtTogether,
  boughtTogetherChanges,
  DEFAULT_LAYOUT,
  DEFAULT_PAGE_BUILDER,
  lowStockText,
  pageBuilderOf,
  storefrontConfig,
  suggestBlocks,
  validatePageBuilder,
  withProduct,
} from "./page-builder.js";

const P = (n) => `gid://shopify/Product/${n}`;
const C = (n) => `gid://shopify/Collection/${n}`;
const withBlock = (type, change) => ({
  blocks: DEFAULT_PAGE_BUILDER.blocks.map((b) => (b.type === type ? { ...b, ...change, settings: { ...b.settings, ...change.settings } } : b)),
});
const errorsOf = (body) => validatePageBuilder(body).errors?.map((e) => `${e.field}: ${e.message}`) ?? [];

test("the defaults are valid and show nothing", () => {
  assert.deepEqual(validatePageBuilder(DEFAULT_PAGE_BUILDER), { ok: true, value: DEFAULT_PAGE_BUILDER });
  const defaultLayout = { elements: ["gallery", "title", "price", "variants", "quantity", "buy_buttons", "blocks", "description"], gallery: "thumbnails", columns: 2, buy_now: true, vendor: false, sale_badge: true };
  assert.deepEqual(storefrontConfig(DEFAULT_PAGE_BUILDER, { included: true }), { v: 1, blocks: [], layout: defaultLayout });
  // Saved before the full page existed: the default layout.
  assert.deepEqual(validatePageBuilder({ blocks: DEFAULT_PAGE_BUILDER.blocks }).value.layout, DEFAULT_LAYOUT);
});

test("the full product page: every part once, in the merchant's order; the parts that sell stay on", () => {
  const layout = (change) => ({ blocks: DEFAULT_PAGE_BUILDER.blocks, layout: { ...DEFAULT_LAYOUT, ...change } });
  const moved = [...DEFAULT_LAYOUT.elements].reverse().map((e) => (e.type === "quantity" ? { ...e, enabled: false } : e));
  const custom = validatePageBuilder(layout({ elements: moved, gallery: "stacked", columns: 1, buyNow: false, vendor: true })).value.layout;
  assert.deepEqual(custom.elements.map((e) => e.type), ["description", "blocks", "buy_buttons", "quantity", "variants", "price", "title", "gallery"]);
  const config = storefrontConfig({ ...DEFAULT_PAGE_BUILDER, layout: custom }, { included: true }).layout;
  assert.deepEqual(config, { elements: ["description", "blocks", "buy_buttons", "variants", "price", "title", "gallery"], gallery: "stacked", columns: 1, buy_now: false, vendor: true, sale_badge: true });
  // Without the plan: the default page (it may be the store's product page), no blocks.
  assert.deepEqual(storefrontConfig({ ...DEFAULT_PAGE_BUILDER, layout: custom }, { included: false }).layout.columns, 2);

  const off = DEFAULT_LAYOUT.elements.map((e) => (e.type === "buy_buttons" ? { ...e, enabled: false } : e));
  assert.deepEqual(errorsOf(layout({ elements: off })), ["layout: Buy buttons can't be turned off: the page can't sell without it."]);
  assert.deepEqual(errorsOf(layout({ elements: DEFAULT_LAYOUT.elements.slice(1) })), ["layout: The product page's parts aren't valid."]);
  assert.deepEqual(errorsOf(layout({ gallery: "carousel" })), ["layout: Choose how the photos show."]);
  assert.deepEqual(errorsOf(layout({ columns: 3 })), ["layout: Choose one or two columns."]);
  assert.deepEqual(errorsOf(layout({ vendor: "yes" })), ["layout: A product page setting is missing."]);
});

test("suggested blocks per product, with why; not where a block already shows", () => {
  const product = {
    gid: P(1),
    collections: [C(9)],
    status: "page_problem",
    reasons: ["returned_often"],
    options: ["Color", "Size"],
    variants: [{ inventoryQty: 2, sellsWhenOut: false }, { inventoryQty: 30, sellsWhenOut: false }, { inventoryQty: 0, sellsWhenOut: true }],
    boughtTogether: [P(2), P(3)],
  };
  assert.deepEqual(suggestBlocks(product, DEFAULT_PAGE_BUILDER), [
    { type: "size_chart", reason: "Returned often, and it comes in sizes." },
    { type: "low_stock", reason: "1 variant with 5 or fewer left." },
    { type: "trust_badges", reason: "Many visit its page, few buy." },
    { type: "bought_together", reason: "Often bought with 2 other products." },
  ]);
  // Already on for all products, or for this product's collection: not suggested. On for some
  // collections without it: can't take it without changing others, not suggested either.
  const covered = { blocks: [...withBlock("trust_badges", { enabled: true }).blocks.slice(0, 2), ...withBlock("size_chart", { enabled: true, useFor: { mode: "collections", collectionIds: [C(9)], productIds: [] } }).blocks.slice(2)], layout: DEFAULT_LAYOUT };
  assert.deepEqual(suggestBlocks(product, covered).map((s) => s.type), ["low_stock", "bought_together"]);
  const other = withBlock("bought_together", { enabled: true, useFor: { mode: "collections", collectionIds: [C(4)], productIds: [] } });
  assert.ok(!suggestBlocks(product, { ...other, layout: DEFAULT_LAYOUT }).some((s) => s.type === "bought_together"));
  // No sizes, nothing low, healthy, no partners: nothing to suggest. Dead stock gets no "Only X left".
  assert.deepEqual(suggestBlocks({ gid: P(5), collections: [], status: "healthy", reasons: [], options: ["Color"], variants: [{ inventoryQty: 50 }], boughtTogether: [] }, DEFAULT_PAGE_BUILDER), []);
  assert.deepEqual(suggestBlocks({ ...product, status: "dead_stock", reasons: [], boughtTogether: [] }, DEFAULT_PAGE_BUILDER), []);
});

test("using a suggestion turns the block on for that product, without changing it for others", () => {
  const on = withProduct(DEFAULT_PAGE_BUILDER, "size_chart", P(1)).blocks.find((b) => b.type === "size_chart");
  assert.deepEqual([on.enabled, on.useFor], [true, { mode: "products", collectionIds: [], productIds: [P(1)] }]);
  const chosen = withBlock("size_chart", { enabled: true, useFor: { mode: "products", collectionIds: [], productIds: [P(2)] } });
  assert.deepEqual(withProduct(chosen, "size_chart", P(1)).blocks.find((b) => b.type === "size_chart").useFor.productIds, [P(2), P(1)]);
  const all = withBlock("size_chart", { enabled: true });
  assert.deepEqual(withProduct(all, "size_chart", P(1)), all);
  // On for some collections: the merchant's collections are kept (the product isn't added).
  const collections = withBlock("size_chart", { enabled: true, useFor: { mode: "collections", collectionIds: [C(1)], productIds: [] } });
  assert.deepEqual(withProduct(collections, "size_chart", P(5)), collections);
  assert.equal(validatePageBuilder(withProduct(DEFAULT_PAGE_BUILDER, "size_chart", P(1))).ok, true);
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
