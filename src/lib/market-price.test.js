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
  assert.equal(Math.round(gapToMarket(61.5, 52) * 1000) / 1000, 0.183);
  assert.equal(gapToMarket(50, 50), 0);
  assert.ok(gapToMarket(40, 50) < 0);
  assert.equal(gapToMarket(50, null), null);
  assert.equal(gapToMarket(0, 50), null);
});
