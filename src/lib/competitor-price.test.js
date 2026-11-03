import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAmount, priceFromHtml, priceFromShopifyJs, shopifyProductJsUrl } from "./competitor-price.js";

test("amounts in common formats", () => {
  assert.equal(parseAmount("49.90"), 49.9);
  assert.equal(parseAmount("49,90"), 49.9);
  assert.equal(parseAmount("€ 1.299,00"), 1299);
  assert.equal(parseAmount("$1,299.00"), 1299);
  assert.equal(parseAmount("1,299"), 1299);
  assert.equal(parseAmount("1.299.000"), 1299000);
  assert.equal(parseAmount(61.5), 61.5);
  for (const bad of ["", "free", "0", "-5", null, undefined, {}, NaN, "1,2,3"]) assert.equal(parseAmount(bad), null, String(bad));
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
