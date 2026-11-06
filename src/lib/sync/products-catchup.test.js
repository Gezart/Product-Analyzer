import assert from "node:assert/strict";
import { test } from "node:test";
import { catchupSince, MAX_WINDOW_MS, nextMark, OVERLAP_MS, staleProducts, updatedSinceQuery } from "./products-catchup.js";

const now = new Date("2026-11-06T22:00:00.000Z");

test("catchupSince: first run reads the last 25 hours", () => {
  assert.equal(catchupSince(null, now).getTime(), now.getTime() - MAX_WINDOW_MS);
});

test("catchupSince: later runs start a little before the last one", () => {
  const last = new Date("2026-11-06T21:00:00.000Z");
  assert.equal(catchupSince(last, now).getTime(), last.getTime() - OVERLAP_MS);
});

test("catchupSince: a long pause is capped at 25 hours", () => {
  assert.equal(catchupSince(new Date("2026-11-01T00:00:00Z"), now).getTime(), now.getTime() - MAX_WINDOW_MS);
});

test("updatedSinceQuery: whole seconds in Shopify search syntax", () => {
  assert.equal(updatedSinceQuery(new Date("2026-11-06T21:13:46.512Z")), "updated_at:>='2026-11-06T21:13:46Z'");
});

test("staleProducts: missing and older copies are synced, fresh ones skipped", () => {
  const nodes = [
    { id: "gid://shopify/Product/1", updatedAt: "2026-11-06T21:25:41Z" },
    { id: "gid://shopify/Product/2", updatedAt: "2026-11-06T21:35:00Z" },
    { id: "gid://shopify/Product/3", updatedAt: "2026-11-06T21:35:00Z" },
  ];
  const known = new Map([
    ["gid://shopify/Product/2", new Date("2026-11-06T21:30:00Z")],
    ["gid://shopify/Product/3", new Date("2026-11-06T21:36:00Z")],
  ]);
  assert.deepEqual(staleProducts(nodes, known), ["gid://shopify/Product/1", "gid://shopify/Product/2"]);
});

test("nextMark: complete window moves to the run's start", () => {
  assert.equal(nextMark([{ updatedAt: "2026-11-06T21:00:00Z" }], true, now), now);
  assert.equal(nextMark([], false, now), now);
});

test("nextMark: a cut-off window resumes from the last product read", () => {
  const nodes = [{ updatedAt: "2026-11-06T20:00:00Z" }, { updatedAt: "2026-11-06T20:30:00Z" }];
  const mark = nextMark(nodes, false, now);
  assert.equal(catchupSince(mark, now).toISOString(), "2026-11-06T20:30:00.000Z");
});
