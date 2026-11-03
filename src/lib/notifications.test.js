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
  // slow mover → dead stock was already a problem: not "newly".
  assert.equal(attentionSummary(new Map([["a", "slow_mover"]]), [{ id: "a", status: "dead_stock" }]).total, 0);
  // Only excluded or over-limit rows before: the next run is the first analysis.
  assert.equal(attentionSummary(new Map([["a", "excluded"], ["b", "over_limit"]]), [{ id: "a", status: "dead_stock" }]).firstRun, true);
});

test("describe: text and link per type; unknown types still render", () => {
  assert.deepEqual(describe({ type: "analysis_ready", data: { products: 12, counts: { dead_stock: 2, page_problem: 1 } } }), {
    title: "Your first analysis is ready",
    body: "12 products analyzed; 3 need attention (2 dead stock, 1 page problem).",
    href: "/",
  });
  assert.deepEqual(describe({ type: "new_attention", data: { counts: { slow_mover: 1 } } }), {
    title: "1 product newly needs attention",
    body: "1 slow mover.",
    href: "/products?status=slow_mover",
  });
  assert.equal(describe({ type: "new_attention", data: { counts: { slow_mover: 2, dead_stock: 3 } } }).body, "3 dead stock, 2 slow movers.");
  const v = describe({ type: "rescue_verdict", productId: "p1", productTitle: "Tee", data: { verdict: "worse" } });
  assert.equal(v.title, "Fixes made it worse: Tee");
  assert.equal(v.href, "/products/p1");
  assert.equal(describe({ type: "markdown_paused", productId: "p1", productTitle: "Tee" }).title, "Markdown paused: Tee");
  assert.deepEqual(describe({ type: "monthly_report", data: { period: "2026-10", revenueRecovered: 1234.5, currency: "EUR" } }), {
    title: "Your October 2026 report is ready",
    body: "€1,235 revenue recovered.",
    href: "/reports?period=2026-10",
  });
  assert.deepEqual(describe({ type: "something_new", productId: null }), { title: "something new", body: "", href: "/" });
});

test("season notes: one product opens it, several open the seasonal list", () => {
  const soon = describe({ type: "season_soon", productId: null, data: { date: "2026-11-01", days: 27, count: 3 } });
  assert.deepEqual(soon, { title: "Season starts November 1: 3 seasonal products", body: "Check stock and product pages before the season starts.", href: "/products?status=seasonal" });
  const one = describe({ type: "season_soon", productId: "p1", productTitle: "Wool coat", data: { date: "2026-11-01", count: 1 } });
  assert.equal(one.title, "Season starts November 1: Wool coat");
  assert.equal(one.href, "/products/p1");
  const ended = describe({ type: "season_ended", productId: null, data: { date: "2026-08-31", count: 4, stockValue: 1250.5, currency: "EUR" } });
  assert.equal(ended.title, "Season ended with stock left: 4 products");
  assert.match(ended.body, /^€1,251 in stock\. An end-of-season markdown clears it before the next season/);
  assert.equal(ended.href, "/products?status=seasonal");
});

test("the weekly plan in the inbox", () => {
  const n = describe({ type: "weekly_plan", data: { week: "2026-11-02", actions: [{ title: "Linen Shirt" }, { title: "Mug" }] } });
  assert.deepEqual(n, { title: "Your plan for this week", body: "2 actions, starting with Linen Shirt.", href: "/plan?week=2026-11-02" });
});

test("the weekly plan with last week's results", () => {
  const n = describe({ type: "weekly_plan", data: { week: "2026-11-09", currency: "EUR", actions: [], lastWeek: { verdicts: [{}, {}], extraSales: 120 } } });
  assert.match(n.body, /^Nothing urgent this week\. Last week: 2 results \(.*120.* extra sales\)\.$/);
});

test("the weekly plan with only markdown news from last week", () => {
  const n = describe({ type: "weekly_plan", data: { week: "2026-11-09", actions: [], lastWeek: { verdicts: [], extraSales: 0, markdownsStarted: [{}], markdownsEnded: [{}] } } });
  assert.equal(n.body, "Nothing urgent this week. Last week: 2 markdown updates.");
});
