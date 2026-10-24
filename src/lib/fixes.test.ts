import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionChanges, mediaMoves, sameState, validateFix } from "./fixes.ts";

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
});

test("collection changes", () => {
  assert.deepEqual(collectionChanges(["a", "b"], ["b", "c"]), { add: ["c"], remove: ["a"] });
  assert.deepEqual(collectionChanges(["a"], ["a"]), { add: [], remove: [] });
});

test("media moves only touch what changes, and reverse cleanly", () => {
  assert.deepEqual(mediaMoves(["a", "b", "c"], ["c", "a", "b"]), [
    { id: "c", newPosition: "0" },
    { id: "a", newPosition: "1" },
    { id: "b", newPosition: "2" },
  ]);
  assert.deepEqual(mediaMoves(["a", "b", "c"], ["a", "c", "b"]), [{ id: "c", newPosition: "1" }, { id: "b", newPosition: "2" }]);
  assert.deepEqual(mediaMoves(["a", "b"], ["a", "b"]), []);
});
