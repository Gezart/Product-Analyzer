import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBlocker, changedTypes, checklist, fillInParts, plainText, wordCount } from "./fix-page.js";

const live = {
  title: "Linen Shirt",
  descriptionHtml: "<p>A shirt.</p>",
  seo: { title: null, description: null },
  media: [{ id: "m1" }, { id: "m2" }],
  collections: [{ id: "c1", manual: true }, { id: "s1", manual: false }],
};
const drafts = (over = {}) => ({ title: "Linen Shirt", description: "<p>A shirt.</p>", seoTitle: "", seoDescription: "", mediaIds: ["m1", "m2"], collectionIds: ["c1"], photoCount: 2, ...over });

test("words in a description's HTML", () => {
  assert.equal(wordCount("<p>A relaxed <strong>shirt</strong> &amp; more.</p><ul><li>S – XL</li></ul>"), 6);
  assert.equal(wordCount(""), 0);
  assert.equal(wordCount(null), 0);
  assert.equal(plainText('<p style="width: 10px">Made <b>of</b>&nbsp;linen</p>'), "Made of linen");
});

test("fill-in placeholders are picked out of the text", () => {
  assert.deepEqual(fillInParts("A shirt in [fill in: fabric] for summer."), [
    { text: "A shirt in ", fillIn: false },
    { text: "[fill in: fabric]", fillIn: true },
    { text: " for summer.", fillIn: false },
  ]);
  assert.deepEqual(fillInParts("No gaps."), [{ text: "No gaps.", fillIn: false }]);
  assert.deepEqual(fillInParts("[fill in: care]"), [{ text: "[fill in: care]", fillIn: true }]);
});

test("which drafts differ from the live product, in the order they're applied", () => {
  assert.deepEqual(changedTypes(live, drafts()), []);
  assert.deepEqual(
    changedTypes(live, drafts({ title: "Relaxed Linen Shirt", seoTitle: "Linen", mediaIds: ["m2", "m1"], collectionIds: ["c1", "c2"], description: "<p>New.</p>" })),
    ["title", "description", "seo", "images", "collection"],
  );
  // Spaces around a title or SEO text don't count as a change; the order of collections doesn't either.
  assert.deepEqual(changedTypes(live, drafts({ title: " Linen Shirt ", seoTitle: "  " })), []);
  assert.deepEqual(changedTypes({ ...live, collections: [{ id: "c1", manual: true }, { id: "c2", manual: true }] }, drafts({ collectionIds: ["c2", "c1"] })), []);
  assert.deepEqual(changedTypes(null, drafts()), []);
});

test("what blocks applying: an empty or long title, long SEO texts, fill-ins left", () => {
  assert.equal(applyBlocker(["title"], drafts({ title: " " })), "The title can't be empty.");
  assert.equal(applyBlocker(["title"], drafts({ title: "x".repeat(256) })), "The title can be at most 255 characters.");
  assert.equal(applyBlocker(["seo"], drafts({ seoTitle: "x".repeat(71) })), "The SEO title can be at most 70 characters.");
  assert.equal(applyBlocker(["seo"], drafts({ seoDescription: "x".repeat(321) })), "The meta description can be at most 320 characters.");
  assert.equal(applyBlocker(["description"], drafts({ description: "In [fill in: fabric]." })), "Fill in fabric first (where it says [fill in: …]).");
  // A fill-in in a draft that isn't changing doesn't block the others.
  assert.equal(applyBlocker(["title"], drafts({ title: "New", seoTitle: "[fill in: brand]" })), null);
  assert.equal(applyBlocker([], drafts()), null);
});

test("the checklist from the diagnosis ticks what the drafts fix", () => {
  const reasons = [
    { code: "few_images", data: { images: 2, minimum: 3 } },
    { code: "short_description", data: { words: 3, minimum: 5 } },
    { code: "missing_details", data: { missing: ["material"] } },
    { code: "missing_seo", data: {} },
    { code: "low_traffic_collections", data: {} },
    { code: "broken_size_run", data: { outOfStock: ["S", "M"] } },
    { code: "price_above_market", data: {} },
    { code: "something_new" },
  ];
  const before = checklist(reasons, drafts(), live);
  assert.deepEqual(before.map((c) => c.done), [false, false, false, false, false, false, false, false]);
  assert.equal(before[0].text, "At least 3 photos");
  assert.equal(before[5].text, "S, M out of stock: restock");
  const after = checklist(
    reasons,
    drafts({ photoCount: 3, description: "<p>Cotton shirt in sizes S to XL, ideal for summer days.</p>", seoTitle: "Shirt", seoDescription: "A shirt", collectionIds: ["c1", "c9"] }),
    live,
  );
  assert.deepEqual(after.map((c) => c.done), [true, true, true, true, true, false, false, false]);
  assert.equal(checklist(null, drafts(), live).length, 0);
  // The word lists read the text, not the tags: "font-weight" in a style isn't a size, "made <strong>of</strong>" is a material.
  const styled = '<p><span style="font-weight: 400;">A cotton shirt to wash cold.</span></p>';
  assert.equal(checklist([{ code: "missing_details" }], drafts({ description: styled }), { ...live, descriptionHtml: styled })[0].done, false);
  assert.equal(checklist([{ code: "missing_details" }], drafts({ description: "<p>Size M, made <strong>of</strong> it, wash cold.</p>" }), live)[0].done, true);
  // Automated collections count for "in at least one collection".
  assert.equal(checklist([{ code: "no_collection" }], drafts({ collectionIds: [] }), live)[0].done, true);
  assert.equal(checklist([{ code: "no_collection" }], drafts({ collectionIds: [] }), { ...live, collections: [] })[0].done, false);
});
