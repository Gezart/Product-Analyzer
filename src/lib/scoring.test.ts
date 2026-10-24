import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_THRESHOLDS,
  computeMetrics,
  quantile,
  scoreProducts,
  type ProductInput,
} from "./scoring.ts";

function product(overrides: Partial<ProductInput> & { id: string }): ProductInput {
  return {
    stock: 50,
    price: 40,
    cost: 20,
    units30: 10,
    unitsPrev30: 10,
    units60: 20,
    views30: 200,
    purchases30: 10,
    daysSinceLastSale: 2,
    ...overrides,
  };
}

// A store of "normal" products so medians are stable: 200 views, 5% conversion.
function store(...extra: ProductInput[]): ProductInput[] {
  const base = Array.from({ length: 8 }, (_, i) => product({ id: `n${i}`, views30: 160 + i * 20, purchases30: 8 + i }));
  return [...base, ...extra];
}

function statusOf(results: ReturnType<typeof scoreProducts>, id: string) {
  return results.find((r) => r.id === id)!.status;
}

test("metrics follow the plan formulas", () => {
  const m = computeMetrics(product({ id: "a", stock: 30, units30: 15, unitsPrev30: 5, units60: 20, cost: 10 }));
  assert.equal(m.sellThrough, 20 / 50);
  assert.equal(m.daysOfCover, 30 / (15 / 30));
  assert.equal(m.stockValue, 300);
  assert.equal(m.trend, 3);
  assert.equal(m.costIsEstimate, false);
});

test("missing cost uses price × 0.5 and is flagged", () => {
  const m = computeMetrics(product({ id: "a", stock: 10, price: 30, cost: null }));
  assert.equal(m.stockValue, 150);
  assert.equal(m.costIsEstimate, true);
});

test("no sales gives null cover, trend and conversion instead of Infinity", () => {
  const m = computeMetrics(product({ id: "a", units30: 0, unitsPrev30: 0, units60: 0, views30: 0, purchases30: 0 }));
  assert.equal(m.daysOfCover, null);
  assert.equal(m.trend, null);
  assert.equal(m.conversion, null);
});

test("quantile interpolates", () => {
  assert.equal(quantile([0, 10, 20, 30, 40], 0.5), 20);
  assert.equal(quantile([0, 10], 0.25), 2.5);
  assert.equal(quantile([], 0.5), 0);
});

test("healthy products stay healthy", () => {
  const results = scoreProducts(store());
  assert.ok(results.every((r) => r.status === "healthy"));
});

test("dead stock: no sale for 90 days with stock", () => {
  const r = scoreProducts(store(product({ id: "d", daysSinceLastSale: 95, units30: 0, unitsPrev30: 0, units60: 0 })));
  assert.equal(statusOf(r, "d"), "dead_stock");
});

test("dead stock needs proof: 60 days of history without a sale is slow, not dead", () => {
  const p = product({ id: "d", daysSinceLastSale: null, units30: 0, unitsPrev30: 0, units60: 0 });
  assert.equal(statusOf(scoreProducts(store(p), {}, 60), "d"), "slow_mover");
  assert.equal(statusOf(scoreProducts(store(p), {}, 90), "d"), "dead_stock");
});

test("no stock is never dead stock", () => {
  const r = scoreProducts(store(product({ id: "d", stock: 0, daysSinceLastSale: 200, units30: 0, unitsPrev30: 0, units60: 0 })));
  assert.notEqual(statusOf(r, "d"), "dead_stock");
});

test("stock-out risk: under 14 days of cover and not declining", () => {
  const r = scoreProducts(store(product({ id: "s", stock: 5, units30: 30, unitsPrev30: 20, units60: 50 })));
  assert.equal(statusOf(r, "s"), "stockout_risk");
});

test("declining product with low cover is not stock-out risk", () => {
  const r = scoreProducts(store(product({ id: "s", stock: 5, units30: 30, unitsPrev30: 60, units60: 90 })));
  assert.notEqual(statusOf(r, "s"), "stockout_risk");
});

test("page problem: top views, conversion under half the median", () => {
  const r = scoreProducts(store(product({ id: "p", views30: 2000, purchases30: 10 })));
  assert.equal(statusOf(r, "p"), "page_problem");
});

test("slow mover: 60-day sell-through under 20% while still selling", () => {
  const r = scoreProducts(store(product({ id: "slow", stock: 200, units30: 5, unitsPrev30: 5, units60: 10, views30: 160, purchases30: 8 })));
  assert.equal(statusOf(r, "slow"), "slow_mover");
});

test("hidden gem: bottom views, conversion above median", () => {
  const r = scoreProducts(store(product({ id: "g", views30: 25, purchases30: 5 })));
  assert.equal(statusOf(r, "g"), "hidden_gem");
});

test("too few views never triggers conversion statuses", () => {
  const r = scoreProducts(store(product({ id: "g", views30: 5, purchases30: 3 })));
  assert.equal(statusOf(r, "g"), "healthy");
});

test("thresholds are editable", () => {
  const p = product({ id: "d", daysSinceLastSale: 40, units30: 0, unitsPrev30: 0, units60: 0 });
  assert.notEqual(statusOf(scoreProducts(store(p)), "d"), "dead_stock");
  assert.equal(statusOf(scoreProducts(store(p), { deadDays: 30 }), "d"), "dead_stock");
});

test("money at stake = stock value × status weight, sorted descending", () => {
  const r = scoreProducts(
    store(
      product({ id: "d", stock: 10, cost: 10, daysSinceLastSale: 120, units30: 0, unitsPrev30: 0, units60: 0 }),
      product({ id: "slow", stock: 200, cost: 10, units30: 5, unitsPrev30: 5, units60: 10, views30: 160, purchases30: 8 }),
    ),
  );
  const dead = r.find((x) => x.id === "d")!;
  const slow = r.find((x) => x.id === "slow")!;
  assert.equal(dead.moneyAtStake, 100 * 1);
  assert.equal(slow.moneyAtStake, 2000 * 0.7);
  assert.equal(r[0].id, "slow");
  assert.ok(r.filter((x) => x.status === "healthy").every((x) => x.moneyAtStake === 0));
});

test("defaults match the plan", () => {
  assert.deepEqual(
    [DEFAULT_THRESHOLDS.deadDays, DEFAULT_THRESHOLDS.slowSellThrough, DEFAULT_THRESHOLDS.stockoutCoverDays],
    [90, 0.2, 14],
  );
});
