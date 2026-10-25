import assert from "node:assert/strict";
import { test } from "node:test";
import { stuckSplit, summarize } from "./dashboard.js";

const row = (o) => ({
  title: o.productId,
  moneyAtStake: 0,
  stockValue: 0,
  costIsEstimate: false,
  sellThrough: null,
  daysOfCover: null,
  ...o,
});

test("money stuck = stock value of dead stock and slow movers; estimate flag carried", () => {
  const s = summarize([
    row({ productId: "a", status: "dead_stock", stockValue: 1000, moneyAtStake: 1000, costIsEstimate: true }),
    row({ productId: "b", status: "slow_mover", stockValue: 500, moneyAtStake: 350 }),
    row({ productId: "c", status: "page_problem", stockValue: 800, moneyAtStake: 480 }),
    row({ productId: "d", status: "healthy", stockValue: 9000 }),
    row({ productId: "e", status: "excluded", stockValue: 7000 }),
    row({ productId: "f", status: "over_limit", stockValue: 300 }),
  ]);
  assert.equal(s.moneyStuck, 1500);
  assert.equal(s.moneyStuckIsEstimate, true);
  assert.equal(s.productCount, 4);
  assert.equal(s.overLimit, 1);
  assert.deepEqual(s.byStatus.find((x) => x.status === "page_problem"), { status: "page_problem", count: 1, stockValue: 800, moneyAtStake: 480 });
});

test("top list: money at stake first, then stock-out risks by fewest days left; healthy never listed", () => {
  const s = summarize([
    row({ productId: "gem", status: "hidden_gem", moneyAtStake: 40 }),
    row({ productId: "dead", status: "dead_stock", moneyAtStake: 900 }),
    row({ productId: "out5", status: "stockout_risk", daysOfCover: 5 }),
    row({ productId: "out2", status: "stockout_risk", daysOfCover: 2 }),
    row({ productId: "ok", status: "healthy" }),
  ]);
  assert.deepEqual(s.top.map((r) => r.productId), ["dead", "gem", "out2", "out5"]);
});

test("top list keeps 3 places for stock-out risks even with many products at stake", () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => row({ productId: `p${i}`, status: "slow_mover", moneyAtStake: 100 + i })),
    row({ productId: "out7", status: "stockout_risk", daysOfCover: 7 }),
  ];
  const s = summarize(rows);
  assert.equal(s.top.length, 10);
  assert.deepEqual(s.top.slice(-1).map((r) => r.productId), ["out7"]);
  assert.equal(s.top[0].productId, "p11");
});

test("top list is capped", () => {
  const rows = Array.from({ length: 15 }, (_, i) => row({ productId: `p${i}`, status: "dead_stock", moneyAtStake: i + 1 }));
  const s = summarize(rows);
  assert.equal(s.top.length, 10);
  assert.equal(s.top[0].productId, "p14");
});

test("needs attention counts every analyzed status except healthy and new; money at stake is the total", () => {
  const s = summarize([
    row({ productId: "a", status: "dead_stock", stockValue: 1000, moneyAtStake: 1000 }),
    row({ productId: "b", status: "page_problem", moneyAtStake: 0 }),
    row({ productId: "c", status: "stockout_risk", daysOfCover: 3 }),
    row({ productId: "d", status: "hidden_gem", stockValue: 100, moneyAtStake: 40.25 }),
    row({ productId: "e", status: "healthy", stockValue: 9000 }),
    row({ productId: "n", status: "new", stockValue: 300 }),
    row({ productId: "f", status: "excluded" }),
    row({ productId: "g", status: "over_limit" }),
  ]);
  assert.equal(s.needsAttention, 4);
  assert.equal(s.moneyAtStakeTotal, 1040.25);
});

test("stuck split: dead stock share of the stuck value, and products with no stock value still counted", () => {
  const split = (rows) => stuckSplit(summarize(rows).byStatus);
  assert.deepEqual(
    split([row({ productId: "a", status: "dead_stock", stockValue: 250 }), row({ productId: "b", status: "slow_mover", stockValue: 750 })]),
    { products: 2, value: 1000, deadShare: 0.25 },
  );
  assert.deepEqual(split([row({ productId: "a", status: "slow_mover", stockValue: 500 })]), { products: 1, value: 500, deadShare: 0 });
  assert.deepEqual(split([row({ productId: "a", status: "dead_stock", stockValue: 0 })]), { products: 1, value: 0, deadShare: 0 });
  assert.deepEqual(split([row({ productId: "a", status: "healthy", stockValue: 900 })]), { products: 0, value: 0, deadShare: 0 });
});

test("new products get their own status tile with count and stock value", () => {
  const s = summarize([
    row({ productId: "a", status: "new", stockValue: 120.5 }),
    row({ productId: "b", status: "new", stockValue: 79.5 }),
    row({ productId: "c", status: "healthy", stockValue: 900 }),
  ]);
  assert.deepEqual(s.byStatus.find((b) => b.status === "new"), { status: "new", count: 2, stockValue: 200, moneyAtStake: 0 });
  assert.equal(s.productCount, 3);
  assert.equal(s.moneyStuck, 0);
});
