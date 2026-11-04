import assert from "node:assert/strict";
import { test } from "node:test";
import { actionFor, lastWeekOf, pickActions, recapOf, verdictCounts, verdictLine, weekOf } from "./weekly-plan.js";

const p = (productId, status, moneyAtStake, extra = {}) => ({ productId, title: productId, status, moneyAtStake, daysOfCover: null, markdownReason: null, topReason: null, measuring: false, markdownRunning: false, ...extra });

test("the action per product: reorder, markdown, visibility, what holds it back, diagnose, or nothing", () => {
  assert.equal(actionFor(p("a", "stockout_risk", 0, { daysOfCover: 4.4 })).text, "Reorder: about 4 days of stock left.");
  assert.equal(actionFor(p("a2", "stockout_risk", 0)).text, "Reorder before it sells out.");
  const b = actionFor(p("b", "dead_stock", 500, { markdownReason: "Dead stock: no sale for a long time.", topReason: { code: "few_images", label: "Too few images", link: "#page" } }));
  assert.deepEqual([b.kind, b.href], ["markdown", "/products/b/markdown"]);
  const c = actionFor(p("c", "slow_mover", 300, { diagnosed: true, topReason: { code: "store_checkout_issue", label: "Shoppers drop off at checkout", link: "#metrics" } }));
  assert.deepEqual([c.kind, c.text, c.href], ["fix_page", "What holds it back: shoppers drop off at checkout.", "/products/c#metrics"]);
  // A reason without a usable link goes to the diagnosis.
  assert.equal(actionFor(p("c2", "slow_mover", 300, { diagnosed: true, topReason: { code: "x", label: "X", link: "javascript:alert(1)" } })).href, "/products/c2#diagnosis");
  // A hidden gem gets more visibility even with a diagnosis.
  assert.equal(actionFor(p("d", "hidden_gem", 80, { diagnosed: true, topReason: { code: "price_above_peers", label: "Price is high", link: "#overview" } })).kind, "visibility");
  assert.deepEqual([actionFor(p("e", "page_problem", 90)).kind, actionFor(p("e", "page_problem", 90)).href], ["diagnose", "/products/e#diagnosis"]);
  // Diagnosed with nothing found: no "run a diagnosis" every week.
  assert.equal(actionFor(p("e2", "slow_mover", 90, { diagnosed: true })), null);
  assert.equal(actionFor(p("f", "healthy", 0)), null);
  assert.equal(actionFor(p("g", "slow_mover", 900, { measuring: true })), null);
  assert.equal(actionFor(p("h", "dead_stock", 900, { markdownRunning: true })), null);
});

test("this week's actions: most money first, stock-out risks keep two places, at most five", () => {
  const candidates = [
    p("s1", "slow_mover", 100),
    p("d1", "dead_stock", 900),
    p("o1", "stockout_risk", 0, { daysOfCover: 9 }),
    p("s2", "slow_mover", 300),
    p("o2", "stockout_risk", 0, { daysOfCover: 2 }),
    p("o3", "stockout_risk", 0, { daysOfCover: 5 }),
    p("g1", "hidden_gem", 50),
    p("m1", "dead_stock", 2000, { measuring: true }),
    p("h1", "healthy", 0),
  ];
  assert.deepEqual(pickActions(candidates).map((a) => a.productId), ["d1", "s2", "s1", "o2", "o3"]);
  // Few other actions: stock-out risks fill the free places too.
  assert.deepEqual(pickActions([p("o1", "stockout_risk", 0, { daysOfCover: 3 }), p("o2", "stockout_risk", 0, { daysOfCover: 1 }), p("o3", "stockout_risk", 0, { daysOfCover: 2 }), p("s", "slow_mover", 10)]).map((a) => a.productId), ["s", "o2", "o3", "o1"]);
  // Few products: fewer actions; none: none.
  assert.deepEqual(pickActions([p("x", "slow_mover", 10)]).map((a) => a.productId), ["x"]);
  assert.deepEqual(pickActions([p("h", "healthy", 0)]), []);
});

test("the week a day falls in starts on Monday", () => {
  assert.equal(weekOf("2026-11-02"), "2026-11-02"); // Monday
  assert.equal(weekOf("2026-11-08"), "2026-11-02"); // Sunday
  assert.equal(weekOf("2026-11-03"), "2026-11-02");
  assert.equal(weekOf("2027-01-01"), "2026-12-28"); // across the year
});

test("last week's results: verdicts with extra sales, markdowns started and ended", () => {
  assert.deepEqual(lastWeekOf("2026-11-09"), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(lastWeekOf("2027-01-04"), { from: "2026-12-28", to: "2027-01-03" });
  const improved = { productId: "a", title: "A", price: 25, verdict: "improved", result: { after: { units: 14 }, expectedUnits: 9.6 } };
  assert.deepEqual(verdictLine(improved), { productId: "a", title: "A", verdict: "improved", windowTo: null, extraUnits: 4, extraSales: 100 });
  // Worse or unknown: no extra sales; never below zero.
  assert.equal(verdictLine({ ...improved, verdict: "worse" }).extraSales, null);
  assert.equal(verdictLine({ ...improved, result: { after: { units: 5 }, expectedUnits: 9 } }).extraUnits, 0);
  const recap = recapOf({
    verdicts: [{ productId: "w", title: "W", price: 10, verdict: "worse", result: {} }, improved, { productId: "b", title: "B", price: 10, verdict: "improved", result: { after: { units: 30 }, expectedUnits: 10 } }],
    started: [{ productId: "m", title: "M" }],
  });
  assert.deepEqual(recap.verdicts.map((v) => v.productId), ["b", "a", "w"]);
  assert.equal(recap.extraSales, 300);
  assert.equal(recapOf({}), null);
});

test("a verdict is in last week's results once: last week's, or a late one not reported yet", () => {
  const range = { from: "2026-11-09", to: "2026-11-15", earliest: "2026-10-19", reported: new Set(["a:2026-11-01"]) };
  assert.equal(verdictCounts("a", "2026-11-10", range), true); // last week
  assert.equal(verdictCounts("a", "2026-11-15", range), true); // Sunday
  assert.equal(verdictCounts("a", "2026-11-16", range), false); // this week: next plan
  assert.equal(verdictCounts("a", "2026-11-01", range), false); // earlier, already reported
  assert.equal(verdictCounts("b", "2026-11-01", range), true); // earlier, decided late
  assert.equal(verdictCounts("b", "2026-10-18", range), false); // too old
  assert.equal(verdictCounts("b", null, range), false);
});
