import assert from "node:assert/strict";
import { test } from "node:test";
import { actionFor, pickActions, weekOf } from "./weekly-plan.js";

const p = (productId, status, moneyAtStake, extra = {}) => ({ productId, title: productId, status, moneyAtStake, daysOfCover: null, markdownReason: null, topReason: null, measuring: false, markdownRunning: false, ...extra });

test("the action per product: reorder, markdown, fix the page, visibility, diagnose, or nothing", () => {
  assert.equal(actionFor(p("a", "stockout_risk", 0, { daysOfCover: 4.4 })).text, "Reorder: about 4 days of stock left.");
  assert.equal(actionFor(p("b", "dead_stock", 500, { markdownReason: "Dead stock: no sale for a long time.", topReason: { code: "few_images", label: "Too few images" } })).kind, "markdown");
  assert.equal(actionFor(p("c", "slow_mover", 300, { topReason: { code: "few_images", label: "Too few images" } })).text, "Fix the page: too few images.");
  assert.equal(actionFor(p("d", "hidden_gem", 80)).kind, "visibility");
  assert.equal(actionFor(p("e", "page_problem", 90)).kind, "diagnose");
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
