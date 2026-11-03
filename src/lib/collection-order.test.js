import assert from "node:assert/strict";
import { test } from "node:test";
import { movedCount, orderError, proposeOrder, sequentialMoves } from "./collection-order.js";

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

test("only analyzed products that can be bestsellers take the bestseller places", () => {
  // Dead stock, page problems, out-of-season and products the app doesn't analyze (status null) sell
  // the most here, but neither become bestsellers nor take a bestseller's place.
  const items = [
    item("h1", "healthy", 100),
    item("dead", "dead_stock", 9000, { moneyAtStake: 50 }),
    item("page", "page_problem", 8000),
    item("season", "seasonal", 7000),
    item("unknown", null, 6000),
    item("h2", "healthy", 90),
    item("h3", "healthy", 80),
  ];
  // Can be bestsellers: h1, h2, h3 → top third is 1 (h1).
  assert.deepEqual(proposeOrder(items).map((e) => `${e.id}:${e.group}`), [
    "h1:bestseller",
    "dead:needs_sales",
    "unknown:keep",
    "h2:keep",
    "h3:keep",
    "page:page_problem",
    "season:out_of_season",
  ]);
});

test("hidden gems keep their current order among themselves (not by money)", () => {
  const items = [item("x", "healthy", 0), item("g1", "hidden_gem", 0, { moneyAtStake: 10 }), item("g2", "hidden_gem", 0, { moneyAtStake: 900 })];
  assert.deepEqual(proposeOrder(items).map((e) => `${e.id}:${e.group}`), ["g1:hidden_gem", "g2:hidden_gem", "x:keep"]);
});

test("slow movers and out-of-season products never take a bestseller place; running low comes after", () => {
  const items = [
    item("h1", "healthy", 300),
    item("slow", "slow_mover", 9000, { moneyAtStake: 5 }),
    item("season", "seasonal", 8000),
    item("low", "stockout_risk", 900),
    item("h2", "healthy", 200),
    item("h3", "healthy", 100),
    item("h4", "healthy", 50),
    item("h5", "healthy", 40),
  ];
  // Can be bestsellers: low 900, h1 300, h2 200, h3 100, h4 50, h5 40 → top third is 2 (low, h1).
  assert.deepEqual(proposeOrder(items).map((e) => `${e.id}:${e.group}`), [
    "h1:bestseller",
    "low:bestseller_low",
    "slow:needs_sales",
    "h2:keep",
    "h3:keep",
    "h4:keep",
    "h5:keep",
    "season:out_of_season",
  ]);
});

test("moved count", () => {
  assert.equal(movedCount(["a", "b", "c"], ["a", "c", "b"]), 2);
  assert.equal(movedCount(["a", "b"], ["a", "b"]), 0);
});

/** Shopify's semantics: each move in turn, `newPosition` counted in the list as it is then. */
function applySequential(list, moves) {
  const out = [...list];
  for (const m of moves) {
    out.splice(out.indexOf(m.id), 1);
    out.splice(Math.min(Number(m.newPosition), out.length), 0, m.id);
  }
  return out;
}

test("collection moves: every order reached with the fewest moves, in batches too", () => {
  const ids = Array.from({ length: 1000 }, (_, i) => `p${i}`);
  // Swapping the first two of 1,000 is one move.
  const swapped = ["p1", "p0", ...ids.slice(2)];
  assert.deepEqual(sequentialMoves(ids, swapped), [{ id: "p1", newPosition: "0" }]);
  assert.deepEqual(sequentialMoves(ids, ids), []);
  // Random orders (and products added or removed since): applied in batches of 250, the target is reached.
  let seed = 7;
  const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  for (let run = 0; run < 40; run++) {
    const n = 1 + Math.floor(rand() * 600);
    const current = Array.from({ length: n }, (_, i) => `q${i}`);
    const target = [...current].sort(() => rand() - 0.5).filter(() => rand() > 0.05);
    const moves = sequentialMoves(current, target);
    let list = current;
    for (let i = 0; i < moves.length; i += 250) list = applySequential(list, moves.slice(i, i + 250));
    assert.deepEqual(list.filter((id) => target.includes(id)), target);
    assert.ok(moves.length <= target.length);
  }
});

test("an order to save lists each product once and differs from now", () => {
  assert.equal(orderError(["b", "a"], ["a", "b"]), null);
  assert.match(orderError(["a"], ["a", "b"]), /once/);
  assert.match(orderError(["a", "a"], ["a", "b"]), /once/);
  assert.match(orderError(["a", "x"], ["a", "b"]), /once/);
  assert.match(orderError("a,b", ["a", "b"]), /once/);
  assert.match(orderError(["a", "b"], ["a", "b"]), /already/);
});
