import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionSummary, describe } from "./notifications.js";

test("attention: first run counts every product in an action status; later only changes into one", () => {
  const now = [
    { id: "a", status: "dead_stock" },
    { id: "b", status: "healthy" },
    { id: "c", status: "page_problem" },
    { id: "d", status: "dead_stock" },
  ];
  assert.deepEqual(attentionSummary(new Map(), now), { firstRun: true, counts: { dead_stock: 2, page_problem: 1 }, total: 3 });
  const before = new Map([
    ["a", "dead_stock"],
    ["b", "slow_mover"],
    ["c", "healthy"],
  ]);
  // a unchanged, b now healthy, c newly page problem, d new product in dead stock.
  assert.deepEqual(attentionSummary(before, now), { firstRun: false, counts: { page_problem: 1, dead_stock: 1 }, total: 2 });
});

test("describe: text and link per type; unknown types still render", () => {
  assert.deepEqual(describe({ type: "analysis_ready", data: { products: 12, counts: { dead_stock: 2, page_problem: 1 } } }), {
    title: "Your first analysis is ready",
    body: "12 products analyzed; 3 need attention (2 dead stock, 1 page problem).",
    href: "/",
  });
  assert.deepEqual(describe({ type: "new_attention", data: { counts: { slow_mover: 1 } } }), { title: "1 product newly needs attention", body: "1 slow mover.", href: "/" });
  assert.equal(describe({ type: "new_attention", data: { counts: { slow_mover: 2, dead_stock: 3 } } }).body, "3 dead stock, 2 slow movers.");
  const v = describe({ type: "rescue_verdict", productId: "p1", productTitle: "Tee", data: { verdict: "worse" } });
  assert.equal(v.title, "Fixes made it worse: Tee");
  assert.equal(v.href, "/products/p1");
  assert.equal(describe({ type: "markdown_paused", productId: "p1", productTitle: "Tee" }).title, "Markdown paused: Tee");
  assert.deepEqual(describe({ type: "something_new", productId: null }), { title: "something new", body: "", href: "/" });
});
