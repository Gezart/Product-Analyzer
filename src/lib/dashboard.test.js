import assert from "node:assert/strict";
import { test } from "node:test";
import { summarize } from "./dashboard.js";

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
  ]);
  assert.equal(s.moneyStuck, 1500);
  assert.equal(s.moneyStuckIsEstimate, true);
  assert.equal(s.productCount, 4);
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

test("top list is capped", () => {
  const rows = Array.from({ length: 15 }, (_, i) => row({ productId: `p${i}`, status: "dead_stock", moneyAtStake: i + 1 }));
  const s = summarize(rows);
  assert.equal(s.top.length, 10);
  assert.equal(s.top[0].productId, "p14");
});
