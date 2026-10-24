import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMoves, collectionChanges, mediaMoves, sameState, validateFix } from "./fixes.ts";

test("validates each fix type", () => {
  assert.deepEqual(validateFix("title", { title: "  New title " }), { ok: true, type: "title", after: { title: "New title" } });
  assert.equal(validateFix("title", { title: " " }).ok, false);
  assert.equal(validateFix("seo", { seoTitle: "x".repeat(71), seoDescription: "" }).ok, false);
  assert.deepEqual(validateFix("seo", { seoTitle: "A", seoDescription: "B" }), { ok: true, type: "seo", after: { seoTitle: "A", seoDescription: "B" } });
  // HTML is kept as written (no trimming), so undo can restore it byte for byte.
  assert.deepEqual(validateFix("description", { descriptionHtml: " <p>Hi</p>\n" }), { ok: true, type: "description", after: { descriptionHtml: " <p>Hi</p>\n" } });
  assert.equal(validateFix("images", { mediaIds: ["gid://shopify/MediaImage/1", "gid://shopify/MediaImage/1"] }).ok, false);
  assert.equal(validateFix("collection", { collectionIds: ["gid://shopify/Product/1"] }).ok, false);
  assert.equal(validateFix("price", {}).ok, false);
});

test("same state: collections as sets, images in order", () => {
  assert.ok(sameState("collection", { collectionIds: ["b", "a"] }, { collectionIds: ["a", "b"] }));
  assert.ok(!sameState("images", { mediaIds: ["a", "b"] }, { mediaIds: ["b", "a"] }));
  assert.ok(sameState("seo", { seoTitle: "A", seoDescription: "B" }, { seoDescription: "B", seoTitle: "A" }));
  assert.ok(!sameState("title", { title: "A" }, { title: "B" }));
  assert.ok(!sameState("collection", null, { collectionIds: [] }));
});

test("collection changes", () => {
  assert.deepEqual(collectionChanges(["a", "b"], ["b", "c"]), { add: ["c"], remove: ["a"] });
  assert.deepEqual(collectionChanges(["a"], ["a"]), { add: [], remove: [] });
});

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

test("media moves reach every order of up to 6 images, and undo restores the original", () => {
  for (let n = 0; n <= 6; n++) {
    const start = Array.from({ length: n }, (_, i) => `m${i}`);
    for (const target of permutations(start)) {
      const after = applyMoves(start, mediaMoves(start, target));
      assert.deepEqual(after, target);
      assert.deepEqual(applyMoves(after, mediaMoves(after, start)), start);
    }
  }
});

test("media moves: nothing to do when the order is the same; unknown ids are ignored", () => {
  assert.deepEqual(mediaMoves(["a", "b"], ["a", "b"]), []);
  assert.deepEqual(applyMoves(["a", "b", "c"], mediaMoves(["a", "b", "c"], ["x", "c", "a", "b"])), ["c", "a", "b"]);
});
