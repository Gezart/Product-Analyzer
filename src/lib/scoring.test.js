import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_THRESHOLDS, STATUS_WEIGHTS, computeMetrics, quantile, sanitizeThresholds, scoreProducts, stockFromVariants } from "./scoring.js";

function product(overrides) {
  const stock = overrides.stock ?? 50;
  return {
    stock,
    stockValue: stock * 20,
    costIsEstimate: false,
    units30: 10,
    unitsPrev30: 10,
    units60: 20,
    views30: 200,
    purchases30: 10,
    daysSinceLastSale: 2,
    ageDays: 365,
    ...overrides,
  };
}

const noSales = { units30: 0, unitsPrev30: 0, units60: 0 };

// "Normal" products with a steady 5% conversion so medians are stable.
function store(...extra) {
  const base = Array.from({ length: 8 }, (_, i) => product({ id: `n${i}`, views30: 160 + i * 20, purchases30: 8 + i }));
  return [...base, ...extra];
}

function find(results, id) {
  return results.find((r) => r.id === id);
}

// --- metrics ---

test("metrics follow the plan formulas", () => {
  const m = computeMetrics(product({ id: "a", stock: 30, units30: 15, unitsPrev30: 5, units60: 20 }));
  assert.equal(m.sellThrough, 20 / 50);
  assert.equal(m.daysOfCover, 30 / (15 / 30));
  assert.equal(m.trend, 3);
  assert.equal(m.conversion, 10 / 200);
});

test("no sales gives null cover, trend and conversion instead of Infinity", () => {
  const m = computeMetrics(product({ id: "a", ...noSales, views30: 0, purchases30: 0 }));
  assert.equal(m.daysOfCover, null);
  assert.equal(m.trend, null);
  assert.equal(m.conversion, null);
});

test("negative stock never yields sell-through above 1 or negative cover", () => {
  const m = computeMetrics(product({ id: "a", stock: -99, units30: 50, unitsPrev30: 50, units60: 100 }));
  assert.equal(m.sellThrough, 1);
  assert.equal(m.daysOfCover, 0);
});

test("stock value is summed per variant with per-variant estimate", () => {
  assert.deepEqual(
    stockFromVariants([
      { stock: 0, price: 200, cost: 100 },
      { stock: 100, price: 20, cost: 10 },
    ]),
    { stock: 100, stockValue: 1000, costIsEstimate: false },
  );
  assert.deepEqual(
    stockFromVariants([
      { stock: 10, price: 30, cost: null },
      { stock: -5, price: 30, cost: 10 },
    ]),
    { stock: 10, stockValue: 150, costIsEstimate: true },
  );
});

test("quantile interpolates and clamps q", () => {
  assert.equal(quantile([0, 10, 20, 30, 40], 0.5), 20);
  assert.equal(quantile([0, 10], 0.25), 2.5);
  assert.equal(quantile([], 0.5), 0);
  assert.equal(quantile([1, 2], 1.5), 2);
});

// --- thresholds ---

test("defaults match the plan", () => {
  assert.deepEqual(DEFAULT_THRESHOLDS, {
    pageProblemViewsTop: 0.4,
    pageProblemConversionRatio: 0.5,
    hiddenGemViewsBottom: 0.4,
    slowSellThrough: 0.2,
    deadDays: 90,
    stockoutCoverDays: 14,
    minViews: 20,
  });
});

test("invalid threshold overrides fall back to defaults", () => {
  const t = sanitizeThresholds({ deadDays: null, minViews: "10", pageProblemViewsTop: 1.5, slowSellThrough: -1, stockoutCoverDays: 7 });
  assert.equal(t.deadDays, 90);
  assert.equal(t.minViews, 20);
  assert.equal(t.pageProblemViewsTop, 0.4);
  assert.equal(t.slowSellThrough, 0.2);
  assert.equal(t.stockoutCoverDays, 7);
  assert.deepEqual(sanitizeThresholds(null), DEFAULT_THRESHOLDS);
  assert.equal(sanitizeThresholds({ deadDays: 0 }).deadDays, 90);
});

test("bad thresholds don't turn the whole store into dead stock", () => {
  const r = scoreProducts(store(), { deadDays: null });
  assert.ok(r.every((x) => x.status === "healthy"));
});

test("thresholds are editable", () => {
  const p = product({ id: "d", daysSinceLastSale: 40, ...noSales });
  assert.notEqual(find(scoreProducts(store(p)), "d").status, "dead_stock");
  assert.equal(find(scoreProducts(store(p), { deadDays: 30 }), "d").status, "dead_stock");
});

// --- statuses ---

test("healthy products stay healthy", () => {
  assert.ok(scoreProducts(store()).every((r) => r.status === "healthy"));
});

test("dead stock: no sale for 90 days with stock", () => {
  assert.equal(find(scoreProducts(store(product({ id: "d", daysSinceLastSale: 95, ...noSales }))), "d").status, "dead_stock");
});

test("dead stock needs proof: short history without a sale is slow, not dead", () => {
  const p = product({ id: "d", daysSinceLastSale: null, ...noSales });
  assert.equal(find(scoreProducts(store(p), {}, 60), "d").status, "slow_mover");
  assert.equal(find(scoreProducts(store(p), {}, 90), "d").status, "dead_stock");
});

test("new products are never dead stock", () => {
  const p = product({ id: "d", daysSinceLastSale: null, ageDays: 7, ...noSales });
  assert.notEqual(find(scoreProducts(store(p), {}, 120), "d").status, "dead_stock");
});

test("no stock is never dead stock", () => {
  const p = product({ id: "d", stock: 0, daysSinceLastSale: 200, ...noSales });
  assert.notEqual(find(scoreProducts(store(p)), "d").status, "dead_stock");
});

test("stock-out risk: under 14 days of cover and not declining", () => {
  const p = product({ id: "s", stock: 5, units30: 30, unitsPrev30: 20, units60: 50 });
  assert.equal(find(scoreProducts(store(p)), "s").status, "stockout_risk");
});

test("declining product with low cover is not stock-out risk", () => {
  const p = product({ id: "s", stock: 5, units30: 30, unitsPrev30: 60, units60: 90 });
  assert.notEqual(find(scoreProducts(store(p)), "s").status, "stockout_risk");
});

test("page problem: top views, conversion under half the median", () => {
  assert.equal(find(scoreProducts(store(product({ id: "p", views30: 2000, purchases30: 10 }))), "p").status, "page_problem");
});

test("slow mover: 60-day sell-through under 20% while still selling", () => {
  const p = product({ id: "slow", stock: 200, units30: 5, unitsPrev30: 5, units60: 10, views30: 160, purchases30: 8 });
  assert.equal(find(scoreProducts(store(p)), "slow").status, "slow_mover");
});

test("hidden gem: bottom views, conversion above median", () => {
  assert.equal(find(scoreProducts(store(product({ id: "g", views30: 25, purchases30: 5 }))), "g").status, "hidden_gem");
});

test("hidden gem works in stores with many low-traffic products", () => {
  const lowTraffic = Array.from({ length: 8 }, (_, i) => product({ id: `z${i}`, views30: i, purchases30: 0 }));
  const r = scoreProducts([...store(product({ id: "g", views30: 25, purchases30: 5 })), ...lowTraffic]);
  assert.equal(find(r, "g").status, "hidden_gem");
});

test("too few views never triggers conversion statuses", () => {
  assert.equal(find(scoreProducts(store(product({ id: "g", views30: 5, purchases30: 3 }))), "g").status, "healthy");
});

// --- precedence ---

test("precedence: dead beats page problem", () => {
  const p = product({ id: "x", daysSinceLastSale: 120, ...noSales, views30: 2000, purchases30: 0 });
  assert.equal(find(scoreProducts(store(p)), "x").status, "dead_stock");
});

test("precedence: stock-out risk beats page problem", () => {
  const p = product({ id: "x", stock: 5, units30: 30, unitsPrev30: 20, units60: 50, views30: 3000, purchases30: 15 });
  assert.equal(find(scoreProducts(store(p)), "x").status, "stockout_risk");
});

test("precedence: page problem beats slow mover", () => {
  const p = product({ id: "x", stock: 500, units30: 5, unitsPrev30: 5, units60: 10, views30: 2000, purchases30: 10 });
  assert.equal(find(scoreProducts(store(p)), "x").status, "page_problem");
});

test("precedence: slow mover beats hidden gem", () => {
  const p = product({ id: "x", stock: 500, units30: 5, unitsPrev30: 5, units60: 10, views30: 25, purchases30: 5 });
  assert.equal(find(scoreProducts(store(p)), "x").status, "slow_mover");
});

// --- money at stake ---

test("weights match the plan", () => {
  assert.deepEqual(STATUS_WEIGHTS, {
    dead_stock: 1,
    slow_mover: 0.7,
    page_problem: 0.6,
    hidden_gem: 0.4,
    stockout_risk: 0,
    healthy: 0,
    excluded: 0,
  });
});

test("money at stake = stock value × status weight for every status, sorted descending", () => {
  const r = scoreProducts(
    store(
      product({ id: "dead", stock: 10, stockValue: 100, daysSinceLastSale: 120, ...noSales }),
      product({ id: "slow", stock: 200, stockValue: 2000, units30: 5, unitsPrev30: 5, units60: 10, views30: 160, purchases30: 8 }),
      product({ id: "page", stockValue: 1000, views30: 2000, purchases30: 10 }),
      product({ id: "gem", stockValue: 1000, views30: 25, purchases30: 5 }),
      product({ id: "out", stock: 5, stockValue: 100, units30: 30, unitsPrev30: 20, units60: 50 }),
    ),
  );
  assert.equal(find(r, "dead").moneyAtStake, 100);
  assert.equal(find(r, "slow").moneyAtStake, 1400);
  assert.equal(find(r, "page").moneyAtStake, 600);
  assert.equal(find(r, "gem").moneyAtStake, 400);
  assert.equal(find(r, "out").moneyAtStake, 0);
  assert.deepEqual(r.slice(0, 4).map((x) => x.id), ["slow", "page", "gem", "dead"]);
  assert.ok(r.filter((x) => x.status === "healthy").every((x) => x.moneyAtStake === 0));
});

test("products sold without stock (untracked, e.g. gift cards) are never a stock-out risk", () => {
  const base = { id: "g", stock: 0, stockValue: 0, costIsEstimate: false, units30: 10, unitsPrev30: 5, units60: 15, views30: 0, purchases30: 0, daysSinceLastSale: 1, ageDays: 400 };
  const [tracked] = scoreProducts([{ ...base, sellsWhenOut: false }], undefined, 60);
  const [untracked] = scoreProducts([{ ...base, sellsWhenOut: true }], undefined, 60);
  assert.equal(tracked.status, "stockout_risk");
  assert.notEqual(untracked.status, "stockout_risk");
  // Selling past zero is allowed, but there is still stock running low: still a risk.
  const [continueSelling] = scoreProducts([{ ...base, stock: 3, stockValue: 30, sellsWhenOut: true }], undefined, 60);
  assert.equal(continueSelling.status, "stockout_risk");
});

test("a product listed less than 30 days ago isn't a slow mover yet", () => {
  const base = { id: "n", stock: 50, stockValue: 500, costIsEstimate: false, units30: 0, unitsPrev30: 0, units60: 0, views30: 0, purchases30: 0, daysSinceLastSale: null };
  const [young] = scoreProducts([{ ...base, ageDays: 20 }], undefined, 60);
  const [older] = scoreProducts([{ ...base, ageDays: 45 }], undefined, 60);
  assert.notEqual(young.status, "slow_mover");
  assert.equal(older.status, "slow_mover");
});
