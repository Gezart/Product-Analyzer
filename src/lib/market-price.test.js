import assert from "node:assert/strict";
import { test } from "node:test";
import { competitorSummary, gapToMarket } from "./market-price.js";

const link = (price, currency, status = "ok") => ({ price, currency, status });

test("competitor price: median of links read in the shop's currency", () => {
  const links = [link(55, "EUR"), link(49, "EUR"), link(52, "EUR"), link(40, "USD"), link(45, null), link(30, "EUR", "failed"), link(null, null, "pending")];
  assert.deepEqual(competitorSummary(links, "EUR"), { median: 52, count: 3, otherCurrency: 1, unknownCurrency: 1 });
  assert.deepEqual(competitorSummary([link(49.99, "EUR"), link(55, "EUR")], "EUR"), { median: 52.5, count: 2, otherCurrency: 0, unknownCurrency: 0 });
});

test("no comparable link or no shop currency: no median", () => {
  assert.equal(competitorSummary([link(40, "USD")], "EUR").median, null);
  assert.equal(competitorSummary([link(40, "EUR")], null).median, null);
  assert.equal(competitorSummary([], "EUR").count, 0);
});

test("gap to the market price", () => {
  assert.equal(gapToMarket(61.5, 52), 0.1827);
  assert.equal(gapToMarket(50, 50), 0);
  assert.ok(gapToMarket(40, 50) < 0);
  assert.equal(gapToMarket(50, null), null);
  assert.equal(gapToMarket(0, 50), null);
});

test("the gap is rounded the same way the diagnosis compares it", () => {
  assert.equal(gapToMarket(55, 50), 0.1);
  assert.equal(gapToMarket(33, 30), 0.1);
  assert.ok(!(gapToMarket(55, 50) > 0.1), "exactly at the threshold isn't above it");
  assert.equal(gapToMarket(61.5, 52), 0.1827);
});
