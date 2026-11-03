import assert from "node:assert/strict";
import { test } from "node:test";
import { currencyFromHtml, parseAmount, priceFromHtml, priceFromShopifyJs, readCompetitorPrice, shopifyProductJsUrl } from "./competitor-price.js";
import { PageFetchError } from "./public-fetch.js";

test("amounts in common formats", () => {
  assert.equal(parseAmount("49.90"), 49.9);
  assert.equal(parseAmount("49,90"), 49.9);
  assert.equal(parseAmount("€ 1.299,00"), 1299);
  assert.equal(parseAmount("$1,299.00"), 1299);
  assert.equal(parseAmount("1,299"), 1299);
  assert.equal(parseAmount("1.299.000"), 1299000);
  assert.equal(parseAmount(61.5), 61.5);
  for (const bad of ["", "free", "0", "-5", "−5", null, undefined, {}, NaN, "1.299,00,5"]) assert.equal(parseAmount(bad), null, String(bad));
});

test("amounts with a currency abbreviation, grouping and spaces", () => {
  assert.equal(parseAmount("Rs. 1,299"), 1299);
  assert.equal(parseAmount("Dhs. 1,299.00"), 1299);
  assert.equal(parseAmount("€1.299"), 1299);
  assert.equal(parseAmount("12.999"), 12999);
  assert.equal(parseAmount("1,299,000"), 1299000);
  assert.equal(parseAmount("₩1,299,000"), 1299000);
  assert.equal(parseAmount("₹1,29,900"), 129900);
  assert.equal(parseAmount("1 299,00 €"), 1299);
  assert.equal(parseAmount("CHF 1'299.50"), 1299.5);
  assert.equal(parseAmount("0,999"), 1);
  assert.equal(parseAmount("USD 49.90"), 49.9);
});

test("machine amounts (JSON-LD) always use a dot for decimals", () => {
  assert.equal(parseAmount("1.299", { machine: true }), 1.3);
  assert.equal(parseAmount("1299.00", { machine: true }), 1299);
  assert.equal(parseAmount("1.299,00", { machine: true }), 1299);
});

const page = (head) => `<!doctype html><html><head>${head}</head><body><h1>Linen shirt</h1></body></html>`;

test("JSON-LD product: lowest in-stock offer and its currency", () => {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Linen shirt",
    offers: [
      { "@type": "Offer", price: "55.00", priceCurrency: "EUR", availability: "https://schema.org/InStock" },
      { "@type": "Offer", price: "39.00", priceCurrency: "EUR", availability: "https://schema.org/OutOfStock" },
      { "@type": "Offer", price: "52.00", priceCurrency: "EUR", availability: "https://schema.org/InStock" },
    ],
  };
  assert.deepEqual(priceFromHtml(page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)), { price: 52, currency: "EUR", source: "json-ld" });
});

test("JSON-LD inside @graph, AggregateOffer and ProductGroup variants", () => {
  const graph = { "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, { "@type": "Product", offers: { "@type": "AggregateOffer", lowPrice: 44.5, highPrice: 60, priceCurrency: "usd" } }] };
  assert.deepEqual(priceFromHtml(page(`<script type='application/ld+json'>${JSON.stringify(graph)}</script>`)), { price: 44.5, currency: "USD", source: "json-ld" });
  const group = { "@type": "ProductGroup", hasVariant: [{ "@type": "Product", offers: { price: "70" } }, { "@type": "Product", offers: { price: "65" } }] };
  const html = page(`<meta property="og:price:currency" content="GBP"><script type="application/ld+json">${JSON.stringify(group)}</script>`);
  assert.deepEqual(priceFromHtml(html), { price: 65, currency: "GBP", source: "json-ld" });
});

test("JSON-LD: only the page's main product, never related products", () => {
  const main = { "@type": "Product", name: "Linen shirt", offers: { price: "100.00", priceCurrency: "EUR" } };
  const related = { "@type": "Product", name: "Socks", offers: { price: "5.00", priceCurrency: "EUR" } };
  assert.equal(priceFromHtml(page(`<script type="application/ld+json">${JSON.stringify([main, related])}</script>`)).price, 100);
  const twoBlocks = page(`<script type="application/ld+json">${JSON.stringify(main)}</script><script type="application/ld+json">${JSON.stringify(related)}</script>`);
  assert.equal(priceFromHtml(twoBlocks).price, 100);
});

test("JSON-LD: offers in several currencies prefer the shop's currency", () => {
  const ld = { "@type": "Product", offers: [{ price: "100", priceCurrency: "EUR" }, { price: "90", priceCurrency: "USD" }] };
  const html = page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
  assert.deepEqual(priceFromHtml(html, "EUR"), { price: 100, currency: "EUR", source: "json-ld" });
  assert.deepEqual(priceFromHtml(html, "USD"), { price: 90, currency: "USD", source: "json-ld" });
  assert.deepEqual(priceFromHtml(html, "GBP"), { price: 90, currency: "USD", source: "json-ld" });
});

test("JSON-LD: an AggregateOffer listing its offers", () => {
  const ld = { "@type": "Product", offers: { "@type": "AggregateOffer", priceCurrency: "EUR", offers: [{ price: "59.00" }, { price: "54.00", availability: "InStock" }] } };
  assert.deepEqual(priceFromHtml(page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)), { price: 54, currency: "EUR", source: "json-ld" });
});

test("broken JSON-LD falls back to meta tags, then microdata", () => {
  const meta = page(`<script type="application/ld+json">{ not json </script><meta property="og:price:amount" content="1.299,00"><meta property="og:price:currency" content="EUR">`);
  assert.deepEqual(priceFromHtml(meta), { price: 1299, currency: "EUR", source: "meta" });
  const reversed = page(`<meta content="49.90" property="product:price:amount">`);
  assert.deepEqual(priceFromHtml(reversed), { price: 49.9, currency: null, source: "meta" });
  const micro = `<div itemscope itemtype="https://schema.org/Product"><span itemprop="price" content="19.99">19,99 €</span></div>`;
  assert.deepEqual(priceFromHtml(micro), { price: 19.99, currency: null, source: "microdata" });
});

test("pages without a price give null", () => {
  assert.equal(priceFromHtml(page("<title>Shop</title>")), null);
  assert.equal(priceFromHtml(""), null);
  assert.equal(priceFromHtml(null), null);
});

test("Shopify product pages and their .js answer", () => {
  assert.equal(shopifyProductJsUrl("https://shop.example/products/linen-shirt?variant=1"), "https://shop.example/products/linen-shirt.js");
  assert.equal(shopifyProductJsUrl("https://shop.example/en-gb/collections/shirts/products/linen-shirt/"), "https://shop.example/en-gb/collections/shirts/products/linen-shirt.js");
  assert.equal(shopifyProductJsUrl("https://shop.example/p/linen-shirt"), null);
  assert.equal(shopifyProductJsUrl("not a url"), null);
  assert.equal(priceFromShopifyJs({ price: 6150, variants: [{ price: 6150, available: true }, { price: 5200, available: false }, { price: 5500, available: true }] }), 55);
  assert.equal(priceFromShopifyJs({ variants: [{ price: 5200, available: false }] }), 52);
  assert.equal(priceFromShopifyJs({ price: 1999 }), 19.99);
  assert.equal(priceFromShopifyJs({}), null);
});

test("the page's currency: price tags, Shopify's active currency, any JSON-LD offer", () => {
  assert.equal(currencyFromHtml(page(`<meta property="og:price:currency" content="eur">`)), "EUR");
  assert.equal(currencyFromHtml(`<script>Shopify.currency = {"active":"GBP","rate":"1.0"};</script>`), "GBP");
  assert.equal(currencyFromHtml(`{"priceCurrency": "CHF"}`), "CHF");
  assert.equal(currencyFromHtml(page("")), null);
});

/** A fake fetcher: pages by URL; a missing URL fails like a 404. */
const fakeFetch = (pages, calls = []) => async (url, options) => {
  calls.push({ url, options });
  if (!(url in pages)) throw new PageFetchError("The page wasn't found (404).");
  return { url, body: pages[url], type: "text/html" };
};

test("reading a competitor: the page's price, in the shop's currency when it has several", async () => {
  const ld = { "@type": "Product", offers: [{ price: "100", priceCurrency: "EUR" }, { price: "90", priceCurrency: "USD" }] };
  const url = "https://shop.example/p/shirt";
  const calls = [];
  const found = await readCompetitorPrice(url, fakeFetch({ [url]: page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`) }, calls), { currency: "EUR" });
  assert.deepEqual(found, { price: 100, currency: "EUR" });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].options.deadline > Date.now(), "a deadline is passed");
});

test("reading a Shopify competitor without price data: the .js answer, in the page's currency, same deadline", async () => {
  const url = "https://shop.example/products/linen-shirt";
  const pages = {
    [url]: page(`<script>Shopify.currency = {"active":"EUR","rate":"1.0"};</script>`),
    [`${url}.js`]: JSON.stringify({ variants: [{ price: 5800, available: true }] }),
  };
  const calls = [];
  assert.deepEqual(await readCompetitorPrice(url, fakeFetch(pages, calls)), { price: 58, currency: "EUR" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.deadline, calls[1].options.deadline);
});

test("reading a competitor without any price fails with a readable message", async () => {
  const url = "https://shop.example/products/linen-shirt";
  await assert.rejects(readCompetitorPrice(url, fakeFetch({ [url]: page("<title>x</title>") })), { message: "No price was found on this page." });
  await assert.rejects(readCompetitorPrice("https://shop.example/gone", fakeFetch({})), { message: "The page wasn't found (404)." });
});
