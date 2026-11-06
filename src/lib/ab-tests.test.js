import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import {
  chanceBBetter,
  countsFrom,
  decide,
  logGamma,
  parseLineProperty,
  purchasesFor,
  RULES,
  storefrontValue,
  testLinesFromBulk,
  testLinesFromWebhook,
  testStats,
  textPreview,
  validateTest,
  variantOf,
  versionView,
} from "./ab-tests.js";

const TEST = "cmhabtest0000000000000001";
const VISITOR = "0123456789abcdef0123456789abcdef";
const DAY = 86_400_000;

test("the chance B is better matches the exact Beta-Binomial answer", () => {
  assert.ok(Math.abs(logGamma(5) - Math.log(24)) < 1e-12);
  assert.ok(Math.abs(logGamma(0.5) - Math.log(Math.sqrt(Math.PI))) < 1e-12);
  // Same numbers: even. More add-to-carts for B: likely better (checked against a simulation).
  assert.ok(Math.abs(chanceBBetter({ visitors: 100, hits: 10 }, { visitors: 100, hits: 10 }) - 0.5) < 1e-9);
  assert.ok(Math.abs(chanceBBetter({ visitors: 100, hits: 10 }, { visitors: 100, hits: 20 }) - 0.9752) < 0.001);
  assert.ok(Math.abs(chanceBBetter({ visitors: 1000, hits: 50 }, { visitors: 1000, hits: 40 }) - 0.1416) < 0.001);
  // Swapping A and B gives the other side's chance.
  const ab = chanceBBetter({ visitors: 300, hits: 21 }, { visitors: 280, hits: 30 });
  const ba = chanceBBetter({ visitors: 280, hits: 30 }, { visitors: 300, hits: 21 });
  assert.ok(Math.abs(ab + ba - 1) < 1e-9);
  // No visitors on a side: no chance yet. Large numbers stay finite and quick.
  assert.equal(chanceBBetter({ visitors: 0, hits: 0 }, { visitors: 10, hits: 1 }), null);
  const big = chanceBBetter({ visitors: 200_000, hits: 20_000 }, { visitors: 200_000, hits: 20_500 });
  assert.ok(big > 0.99 && big <= 1);
});

test("each visitor sees one version, half of them B", () => {
  assert.equal(variantOf(TEST, VISITOR), variantOf(TEST, VISITOR));
  let b = 0;
  for (let i = 0; i < 4000; i++) if (variantOf(TEST, i.toString(16).padStart(32, "0")) === "b") b++;
  assert.ok(b > 1880 && b < 2120, `${b} of 4000 saw B`);
});

test("the storefront script picks the same version as the app", () => {
  const source = readFileSync(new URL("../../extensions/unstuck-storefront/assets/unstuck-ab.js", import.meta.url), "utf8");
  const window = {};
  vm.runInNewContext(source, { window });
  for (let i = 0; i < 200; i++) {
    const visitor = (i * 7919).toString(16).padStart(32, "a");
    assert.equal(window.Unstuck.abVariant(TEST, visitor), variantOf(TEST, visitor));
  }
});

test("version B is checked against the page as it is", () => {
  const title = { title: "Linen shirt" };
  assert.deepEqual(validateTest("title", { title: "  Linen shirt, relaxed fit " }, { a: title }), { ok: true, b: { title: "Linen shirt, relaxed fit" } });
  assert.match(validateTest("title", { title: "Linen shirt" }, { a: title }).error, /same as the page now/);
  assert.match(validateTest("title", { title: "" }, { a: title }).error, /can't be empty/);
  assert.match(validateTest("price", { price: 1 }, { a: title }).error, /title, description or photos/);

  const description = { descriptionHtml: "<p>Soft linen.</p>" };
  assert.equal(validateTest("description", { descriptionHtml: "<p>Soft, breathable linen.</p>" }, { a: description }).ok, true);
  assert.match(validateTest("description", { descriptionHtml: "<p>New</p>" }, { a: { descriptionHtml: "<p> </p>" } }).error, /no description yet/);
  assert.match(validateTest("description", { descriptionHtml: "<p></p>" }, { a: description }).error, /empty/);
  assert.match(validateTest("description", { descriptionHtml: "Size: [fill in: sizes]" }, { a: description }).error, /fill in/);

  const media = ["gid://shopify/MediaImage/1", "gid://shopify/MediaImage/2", "gid://shopify/MediaImage/3"];
  const photos = { a: { mediaIds: media }, mediaTypes: ["IMAGE", "IMAGE", "IMAGE"] };
  assert.deepEqual(validateTest("images", { mediaIds: [media[2], media[0], media[1]] }, photos), { ok: true, b: { mediaIds: [media[2], media[0], media[1]] } });
  assert.match(validateTest("images", { mediaIds: media }, photos).error, /same as the page now/);
  assert.match(validateTest("images", { mediaIds: [media[1], media[0]] }, photos).error, /in a new order/);
  assert.match(validateTest("images", { mediaIds: [media[1], media[0], "gid://shopify/MediaImage/9"] }, photos).error, /in a new order/);
  assert.match(validateTest("images", { mediaIds: [media[1], media[0], media[2]] }, { ...photos, mediaTypes: ["IMAGE", "VIDEO", "IMAGE"] }).error, /photos only/);
  assert.match(validateTest("images", { mediaIds: [media[0]] }, { a: { mediaIds: [media[1]] }, mediaTypes: ["IMAGE"] }).error, /at least 2 photos/);
});

test("the storefront gets the test's id, kind and version B", () => {
  assert.deepEqual(storefrontValue({ id: TEST, kind: "title", b: { title: "New" } }), { id: TEST, kind: "title", title: "New" });
  assert.deepEqual(storefrontValue({ id: TEST, kind: "description", b: { descriptionHtml: "<p>x</p>" } }), { id: TEST, kind: "description", description_html: "<p>x</p>" });
  // Liquid's media.id is the number in the media GID.
  assert.deepEqual(storefrontValue({ id: TEST, kind: "images", b: { mediaIds: ["gid://shopify/MediaImage/22", "gid://shopify/MediaImage/11"] } }), { id: TEST, kind: "images", media_ids: [22, 11] });
});

test("a test stops at 95% either way with enough visitors and days, or after 30 days", () => {
  const start = new Date("2026-11-01T00:00:00Z");
  const at = (days) => new Date(start.getTime() + days * DAY);
  const stats = (a, b) => testStats({ a: { visitors: a[0], carts: a[1] }, b: { visitors: b[0], carts: b[1] } });
  const clearB = stats([400, 20], [400, 45]);
  assert.ok(clearB.chance > 0.99);
  // Clear, but too early or too few visitors: keeps running.
  assert.deepEqual(decide(start, clearB, at(3)), { ended: false });
  assert.deepEqual(decide(start, stats([80, 2], [80, 15]), at(10)), { ended: false });
  assert.deepEqual(decide(start, clearB, at(7)), { ended: true, reason: "b_better", winner: "b" });
  assert.deepEqual(decide(start, stats([400, 45], [400, 20]), at(8)), { ended: true, reason: "a_better", winner: "a" });
  // Unclear: runs to 30 days, then ends without a winner.
  const even = stats([400, 30], [400, 32]);
  assert.deepEqual(decide(start, even, at(29)), { ended: false });
  assert.deepEqual(decide(start, even, at(30)), { ended: true, reason: "time", winner: null });
  // 30 days with too few visitors: no winner even if the chance looks clear.
  assert.deepEqual(decide(start, stats([40, 0], [40, 10]), at(30)), { ended: true, reason: "time", winner: null });
  assert.equal(RULES.threshold, 0.95);
});

test("numbers per version: visitors, add-to-carts and buyers, with their rates", () => {
  const counts = countsFrom(
    [
      { testId: "t1", variant: "a", visitors: 200, carts: 10 },
      { testId: "t1", variant: "b", visitors: 190, carts: 19 },
    ],
    [
      { testId: "t1", variant: "b", units: 2, revenue: 59.8 },
      { testId: "t1", variant: "b", units: 1, revenue: "29.90" },
      { testId: "t1", variant: "a", units: 0, revenue: 0 }, // cancelled: not a buyer
    ],
  );
  const s = testStats(counts.get("t1"));
  assert.equal(s.a.visitors, 200);
  assert.equal(s.a.buyers, 0);
  assert.equal(s.b.buyers, 2);
  assert.equal(s.b.units, 3);
  assert.equal(s.b.revenue, 89.7);
  assert.equal(s.b.cartRate, 0.1);
  assert.equal(s.a.cartRate, 0.05);
  assert.equal(s.b.revenuePerVisitor, 0.47);
  assert.ok(s.chance > 0.95);
  const empty = testStats(undefined);
  assert.equal(empty.a.cartRate, null);
  assert.equal(empty.chance, null);
});

test("purchases: the tested product's lines carrying the test's property, bought while it ran", () => {
  assert.deepEqual(parseLineProperty(`${TEST}:${VISITOR}`), { testId: TEST, visitorId: VISITOR });
  for (const bad of ["", "x:y", `${TEST}:${VISITOR}:1`, `${TEST}:XYZ`, `<b>:${VISITOR}`, null]) assert.equal(parseLineProperty(bad), null);

  const webhook = {
    line_items: [
      { id: 1, admin_graphql_api_id: "gid://shopify/LineItem/1", properties: [{ name: "_unstuck_ab", value: `${TEST}:${VISITOR}` }] },
      { id: 2, properties: [{ name: "Engraving", value: "Hi" }] },
      { id: 3, properties: [{ name: "_unstuck_ab", value: "nonsense" }] },
      { id: 4 },
    ],
  };
  assert.deepEqual(testLinesFromWebhook(webhook), [{ lineGid: "gid://shopify/LineItem/1", testId: TEST, visitorId: VISITOR }]);
  const rows = [
    { id: "gid://shopify/Order/9", createdAt: "2026-11-05T10:00:00Z" },
    { id: "gid://shopify/LineItem/1", __parentId: "gid://shopify/Order/9", customAttributes: [{ key: "_unstuck_ab", value: `${TEST}:${VISITOR}` }] },
    { id: "gid://shopify/LineItem/2", __parentId: "gid://shopify/Order/9", customAttributes: [] },
  ];
  assert.deepEqual(testLinesFromBulk(rows), [{ lineGid: "gid://shopify/LineItem/1", testId: TEST, visitorId: VISITOR }]);

  const product = "gid://shopify/Product/5";
  const tests = new Map([[TEST, { productGid: product, startedAt: new Date("2026-11-01T00:00:00Z"), endedAt: null }]]);
  const orderLines = [{ lineGid: "gid://shopify/LineItem/1", orderGid: "gid://shopify/Order/9", productGid: product, quantity: 2, revenue: 50 }];
  const orderedAt = new Map([["gid://shopify/Order/9", new Date("2026-11-05T10:00:00Z")]]);
  const lines = testLinesFromWebhook(webhook);
  assert.deepEqual(purchasesFor(lines, orderLines, tests, orderedAt), [
    { testId: TEST, lineGid: "gid://shopify/LineItem/1", orderGid: "gid://shopify/Order/9", visitorId: VISITOR, variant: variantOf(TEST, VISITOR), quantity: 2, revenue: 50, orderedAt: new Date("2026-11-05T10:00:00Z") },
  ]);
  // Another product's line, an unknown test, or an order from before the test: not counted.
  assert.deepEqual(purchasesFor(lines, [{ ...orderLines[0], productGid: "gid://shopify/Product/6" }], tests, orderedAt), []);
  assert.deepEqual(purchasesFor(lines, orderLines, new Map(), orderedAt), []);
  assert.deepEqual(purchasesFor(lines, orderLines, tests, new Map([["gid://shopify/Order/9", new Date("2026-10-30T10:00:00Z")]])), []);
  // After the test ended: not counted.
  const ended = new Map([[TEST, { ...tests.get(TEST), endedAt: new Date("2026-11-04T00:00:00Z") }]]);
  assert.deepEqual(purchasesFor(lines, orderLines, ended, orderedAt), []);
});

test("versions as the list shows them", () => {
  assert.deepEqual(versionView("title", { title: "Tee" }), { text: "Tee" });
  assert.deepEqual(versionView("description", { descriptionHtml: "<p>Soft&nbsp;linen</p><script>x()</script>" }), { text: "Soft linen" });
  const previews = { "gid://shopify/MediaImage/1": "https://cdn/1.jpg", "gid://shopify/MediaImage/2": "https://cdn/2.jpg" };
  assert.deepEqual(versionView("images", { mediaIds: ["gid://shopify/MediaImage/2", "gid://shopify/MediaImage/1"] }, previews), { photos: ["https://cdn/2.jpg", "https://cdn/1.jpg"] });
  assert.equal(textPreview("a ".repeat(200), 20).length, 20);
});
