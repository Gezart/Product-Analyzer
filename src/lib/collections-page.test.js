import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionState, dragMove, moveLabel } from "./collections-page.js";

test("a collection's state in the list", () => {
  const c = (latest, extra = {}) => ({ id: "c", title: "Dresses", count: 40, tooLarge: false, latest, ...extra });
  assert.deepEqual(collectionState(c(null)), { text: "Not optimized yet", tone: "muted" });
  const opts = { locale: "en-US", timeZone: "UTC" };
  assert.deepEqual(collectionState(c({ status: "applied", appliedAt: "2026-10-22T10:00:00Z", moved: 5 }), opts), { text: "Applied Oct 22 · 5 moved", tone: "good" });
  assert.deepEqual(collectionState(c({ status: "applied", appliedAt: "2026-10-22T10:00:00Z", moved: 5, error: "Interrupted" }), opts), { text: "Applied with a problem · open to check", tone: "warn" });
  assert.deepEqual(collectionState(c({ status: "undone", undoneAt: "2026-10-25T10:00:00Z", moved: 5 }), opts), { text: "Undone Oct 25", tone: "muted" });
  assert.deepEqual(collectionState(c({ status: "failed", moved: 5 })), { text: "Last save failed", tone: "bad" });
  // Running: saving or undoing, unless the optimizer says it crashed.
  assert.equal(collectionState(c({ status: "applying", moved: 5, interrupted: false })).text, "Saving…");
  assert.equal(collectionState(c({ status: "undoing", moved: 5, interrupted: false })).text, "Undoing…");
  assert.deepEqual(collectionState(c({ status: "applying", moved: 5, interrupted: true })), { text: "Interrupted · open to check", tone: "warn" });
  assert.deepEqual(collectionState(c(null, { tooLarge: true })), { text: "Too many products to reorder here", tone: "warn" });
});

test("a row's move between its place now and its new one", () => {
  assert.deepEqual(moveLabel(30, 4), { text: "↑ 26", tone: "good" });
  assert.deepEqual(moveLabel(5, 19), { text: "↓ 14", tone: "warn" });
  assert.deepEqual(moveLabel(2, 2), { text: "—", tone: "muted" });
});

test("dragging a row onto another's place", () => {
  assert.deepEqual(dragMove(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);
  assert.deepEqual(dragMove(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  const same = ["a", "b"];
  assert.equal(dragMove(same, 1, 1), same);
  assert.equal(dragMove(same, 0, 5), same);
});
