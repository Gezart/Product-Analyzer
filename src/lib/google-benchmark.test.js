import assert from "node:assert/strict";
import { test } from "node:test";
import { BENCHMARK_QUERY, benchmarkRows, FRESH_MS, fromPrice, googleAuthUrl, isFresh, parseOfferId, productBenchmark } from "./google-benchmark.js";

test("the consent link asks for Merchant Center access with a refresh token", () => {
  const url = new URL(googleAuthUrl({ clientId: "id.apps", redirectUri: "https://app.example/api/google/callback", state: "s1" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/content");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "s1");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example/api/google/callback");
});

test("the report query reads the price competitiveness table with its required fields", () => {
  assert.match(BENCHMARK_QUERY, /FROM price_competitiveness_product_view$/);
  for (const field of ["id", "offer_id", "price", "benchmark_price", "report_country_code"]) assert.match(BENCHMARK_QUERY, new RegExp(`\\b${field}\\b`));
});

test("offer IDs from Shopify's Google channel map to the product and variant", () => {
  assert.deepEqual(parseOfferId("shopify_US_8123456789_44123456789"), {
    country: "US",
    productGid: "gid://shopify/Product/8123456789",
    variantGid: "gid://shopify/ProductVariant/44123456789",
  });
  assert.equal(parseOfferId("shopify_de_1_2").country, "DE");
  for (const other of ["SKU-123", "shopify_US_12", "shopify_USA_1_2", "", null]) assert.equal(parseOfferId(other), null, String(other));
});

test("prices in micros", () => {
  assert.deepEqual(fromPrice({ amountMicros: "61500000", currencyCode: "eur" }), { amount: 61.5, currency: "EUR" });
  assert.deepEqual(fromPrice({ amountMicros: "1999999", currencyCode: "USD" }), { amount: 2, currency: "USD" });
  for (const bad of [null, {}, { amountMicros: "0", currencyCode: "EUR" }, { amountMicros: "abc", currencyCode: "EUR" }, { amountMicros: "1000000" }]) assert.equal(fromPrice(bad), null);
});

const row = (offerId, price, benchmark, currency = "EUR", country = "DE", benchmarkCurrency = currency) => ({
  priceCompetitivenessProductView: {
    offerId,
    reportCountryCode: country,
    price: { amountMicros: String(price * 1e6), currencyCode: currency },
    ...(benchmark == null ? {} : { benchmarkPrice: { amountMicros: String(benchmark * 1e6), currencyCode: benchmarkCurrency } }),
  },
});

test("report rows: offers with a benchmark in the same currency as their price", () => {
  const rows = benchmarkRows([row("shopify_DE_1_11", 61.5, 52), row("shopify_DE_1_12", 70, null), row("shopify_US_1_11", 70, 60, "USD", "US", "EUR"), {}, { productView: {} }]);
  assert.deepEqual(rows, [{ offerId: "shopify_DE_1_11", country: "DE", price: 61.5, benchmark: 52, currency: "EUR" }]);
  assert.deepEqual(benchmarkRows(undefined), []);
});

test("a product's Google market price: the cheapest offer's benchmark in the shop's currency", () => {
  const rows = [
    { price: 70, benchmark: 66, currency: "EUR", country: "DE" },
    { price: 61.5, benchmark: 52, currency: "EUR", country: "AT" },
    { price: 40, benchmark: 30, currency: "USD", country: "US" },
  ];
  assert.deepEqual(productBenchmark(rows, "EUR"), { median: 52, count: 2, country: "AT", price: 61.5, source: "google" });
  // The offer priced like the product: a cheaper variant that isn't on Google doesn't take another's benchmark.
  assert.equal(productBenchmark(rows, "EUR", 69).median, 66);
  assert.equal(productBenchmark(rows, "EUR", 61.5).median, 52);
  assert.equal(productBenchmark(rows, "EUR", 65.75).median, 52, "a tie takes the cheaper offer");
  assert.equal(productBenchmark(rows, "GBP"), null);
  assert.equal(productBenchmark([], "EUR"), null);
  assert.equal(productBenchmark(rows, null), null);
});

test("benchmarks count only while connected and read in the last 3 days", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  const ago = (ms) => new Date(now - ms);
  assert.equal(isFresh("connected", ago(60_000), now), true);
  assert.equal(isFresh("connected", ago(FRESH_MS - 1), now), true);
  assert.equal(isFresh("connected", ago(FRESH_MS), now), false, "exactly 3 days is too old");
  assert.equal(isFresh("failed", ago(60_000), now), false);
  assert.equal(isFresh("choose_account", ago(60_000), now), false);
  assert.equal(isFresh("connected", null, now), false);
});
