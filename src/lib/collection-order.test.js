import assert from "node:assert/strict";
import { test } from "node:test";
import { movedCount, proposeOrder } from "./collection-order.js";

const item = (id, status, revenue30 = 0, extra = {}) => ({ id, status, revenue30, moneyAtStake: 0, available: true, ...extra });

test("bestsellers first, then hidden gems and products that need sales, the rest keep their order", () => {
  const items = [
    item("healthy-a", "healthy", 50),
    item("dead", "dead_stock", 0, { moneyAtStake: 300 }),
    item("best", "healthy", 900),
    item("gem", "hidden_gem", 40, { moneyAtStake: 80 }),
    item("slow", "slow_mover", 10, { moneyAtStake: 500 }),
    item("healthy-b", "healthy", 30),
  ];
  // 5 sellers → top third is 2: best (900) and healthy-a (50).
  assert.deepEqual(
    proposeOrder(items).map((e) => [e.id, e.group, e.from, e.to]),
    [
      ["best", "bestseller", 2, 0],
      ["healthy-a", "bestseller", 0, 1],
      ["gem", "hidden_gem", 3, 2],
      ["slow", "needs_sales", 4, 3],
      ["dead", "needs_sales", 1, 4],
      ["healthy-b", "keep", 5, 5],
    ],
  );
});

test("running low after bestsellers; page problems, out of season and sold out last", () => {
  const items = [
    item("sold", "healthy", 999, { available: false }),
    item("season", "seasonal", 0),
    item("page", "page_problem", 500),
    item("low", "stockout_risk", 800),
    item("new", "new", 0),
    item("best", "healthy", 700),
    item("unscored", null, 0),
    item("draft", "healthy", 0, { active: false, available: false }),
  ];
  // Sellers available: page 500, low 800, best 700 → top third is 1 (low). page_problem isn't a bestseller.
  assert.deepEqual(proposeOrder(items).map((e) => `${e.id}:${e.group}`), [
    "low:bestseller_low",
    "new:keep",
    "best:keep",
    "unscored:keep",
    "page:page_problem",
    "season:out_of_season",
    "sold:sold_out",
    "draft:not_on_sale",
  ]);
});

test("a dead-stock top seller is never a bestseller; ties keep the current order", () => {
  const items = [item("a", "slow_mover", 100, { moneyAtStake: 10 }), item("b", "slow_mover", 50, { moneyAtStake: 10 }), item("c", "healthy", 0)];
  assert.deepEqual(proposeOrder(items).map((e) => e.id), ["a", "b", "c"]);
  assert.deepEqual(proposeOrder([]), []);
});

test("moved count", () => {
  assert.equal(movedCount(["a", "b", "c"], ["a", "c", "b"]), 2);
  assert.equal(movedCount(["a", "b"], ["a", "b"]), 0);
});
