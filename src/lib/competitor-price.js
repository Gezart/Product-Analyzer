// Reads a product's price from a competitor's product page. Relative imports only, so node:test can load it.
// Sources, in order: schema.org Product data (JSON-LD), then price meta tags (Open Graph / product:),
// then microdata, then (for Shopify stores) the product's `.js` endpoint. The lowest offer of the page's
// main product is used, like our own price is the cheapest variant.

import { FETCH_TIMEOUT_MS, PageFetchError } from "./public-fetch.js";

const round2 = (n) => Math.round(n * 100) / 100;

/** Currencies written with three decimals ("12.500 KWD" is twelve and a half). */
const THREE_DECIMALS = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/**
 * A price as a number, or null. `machine` values (JSON-LD, microdata `content`) use a dot for decimals
 * ("1299.00", "1.299"); other text may be written for people: "1.299,00", "$1,299.00", "Rs. 1,299",
 * "1 299,00 €", "₹1,29,900". A single separator followed by exactly three digits groups thousands
 * ("1,299", "€1.299"), except in a three-decimal `currency`.
 */
export function parseAmount(value, { machine = false, currency = null } = {}) {
  if (typeof value === "number") return Number.isFinite(value) && round2(value) > 0 ? round2(value) : null;
  if (typeof value !== "string" || /[-\u2212]\s*[\d.,]/.test(value)) return null;
  if (machine && /^\s*\d+(\.\d+)?\s*$/.test(value)) {
    const n = round2(Number(value));
    return n > 0 ? n : null;
  }
  // The first number, without a currency code or sign around it ("Rs.", "Dhs.", "€", "USD").
  const start = value.search(/\d/);
  if (start < 0) return null;
  let s = firstNumber(value, start);
  // ".99" or "$.99" is a decimal; "Rs.99" or "S/.99" is ninety-nine.
  if (/(^|\p{Sc})\s*[.,]$/u.test(value.slice(0, start)) && /^\d+$/.test(s)) s = `0.${s}`;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    // The later separator is the decimal one; the other only groups digits.
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    if (s.split(decimal).length > 2) return null;
    s = s.split(decimal === "," ? "." : ",").join("").replace(decimal, ".");
  } else if (dots + commas > 1) {
    s = s.replace(/[.,]/g, ""); // "1,299,000", "1.299.000", "1,29,900": grouping only
  } else if (dots + commas === 1) {
    const [int, frac] = s.split(/[.,]/);
    const grouping = frac.length === 3 && int && int !== "0" && !THREE_DECIMALS.has(currency);
    s = grouping ? int + frac : `${int || "0"}.${frac}`;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = round2(Number(s));
  return n > 0 ? n : null;
}

/**
 * The digits and separators of the number starting at `start`. A space or apostrophe only groups digits
 * before any decimal separator and when exactly three digits follow ("1 299,00", "CHF 1'299.50"), so
 * "49.90 59.90" and "49.90 199.00" are two numbers.
 */
function firstNumber(value, start) {
  let out = "";
  let separator = false;
  for (let i = start; i < value.length; i++) {
    const c = value[i];
    if (/\d/.test(c)) out += c;
    else if (c === "." || c === ",") {
      out += c;
      separator = true;
    } else if (/['\s\u00a0\u202f]/.test(c) && !separator && /^\d{3}(?!\d)/.test(value.slice(i + 1))) continue;
    else break;
  }
  return out.replace(/[.,]+$/, "");
}

const currencyOf = (v) => (typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : null);

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const typeName = (t) => String(t).toLowerCase().replace(/^https?:\/\/schema\.org\//, "");
const isProduct = (node) => [].concat(node["@type"] ?? []).some((t) => ["product", "productgroup"].includes(typeName(t)));

/**
 * Product objects in the page's JSON-LD blocks, in page order (inside @graph, arrays and a page's
 * mainEntity too), without descending into a product (its variants are read with it).
 */
function jsonLdProducts(html) {
  const products = [];
  const blocks = html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (isProduct(node)) return products.push(node);
    walk(node["@graph"]);
    walk(node.mainEntity);
  };
  for (const [, body] of blocks) {
    try {
      walk(JSON.parse(body.trim()));
    } catch {
      // Broken JSON-LD is common; other blocks and sources are tried.
    }
  }
  return products;
}

const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Two JSON-LD products describe the same item: same @id, url or name. */
function sameProduct(a, b) {
  return ["@id", "url", "name"].some((key) => norm(a[key]) !== "" && norm(a[key]) === norm(b[key]));
}

/** Offers of a product and its variants as `{ price, currency }`, skipping out-of-stock offers when others exist. */
function offerPrices(product) {
  const found = [];
  const readOffer = (offer, inherited) => {
    if (!offer || typeof offer !== "object") return;
    if (Array.isArray(offer)) return offer.forEach((o) => readOffer(o, inherited));
    const currency = currencyOf(offer.priceCurrency) ?? currencyOf(offer.priceSpecification?.priceCurrency) ?? inherited;
    const inStock = !String(offer.availability ?? "").toLowerCase().includes("outofstock");
    const specs = [].concat(offer.priceSpecification ?? []);
    for (const value of [offer.price, offer.lowPrice, ...specs.map((p) => p?.price)]) {
      const price = parseAmount(value, { machine: true, currency });
      if (price != null) found.push({ price, currency, inStock });
    }
    if (offer.offers) readOffer(offer.offers, currency); // AggregateOffer listing its offers
  };
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    readOffer(node.offers, null);
    [].concat(node.hasVariant ?? []).forEach(walk);
  };
  walk(product);
  const inStock = found.filter((f) => f.inStock);
  return (inStock.length ? inStock : found).map(({ price, currency }) => ({ price, currency }));
}

function metaContent(html, names) {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${name.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content);
  }
  return null;
}

/** The page's currency when it says (price meta tags, Shopify's active currency, any JSON-LD offer), or null. */
export function currencyFromHtml(html) {
  if (typeof html !== "string") return null;
  return (
    currencyOf(metaContent(html, ["product:price:currency", "og:price:currency"])) ??
    currencyOf(html.match(/Shopify\.currency\s*=\s*\{\s*"active"\s*:\s*"([A-Za-z]{3})"/)?.[1]) ??
    currencyOf(html.match(/"priceCurrency"\s*:\s*"([A-Za-z]{3})"/)?.[1])
  );
}

/**
 * The lowest price of the page's product and its currency: `{ price, currency, source }`, or null when
 * the page has no price we can trust. With offers in several currencies, `preferred` (the shop's
 * currency) wins when the page has it. `currency` may be null when the page doesn't say.
 */
export function priceFromHtml(html, preferred = null) {
  if (typeof html !== "string" || !html) return null;
  // The page's product is the first one. A later block is only read for the same product (review widgets
  // add one with ratings only); related products are never used, the price tags are read instead.
  const products = jsonLdProducts(html);
  const offers = products.filter((p) => p === products[0] || sameProduct(p, products[0])).map(offerPrices).find((list) => list.length) ?? [];
  const pageCurrency = currencyOf(metaContent(html, ["product:price:currency", "og:price:currency"]));
  if (offers.length) {
    const fallback = pageCurrency ?? offers.find((p) => p.currency)?.currency ?? null;
    const withCurrency = offers.map((o) => ({ ...o, currency: o.currency ?? fallback }));
    const same = preferred ? withCurrency.filter((o) => o.currency === preferred) : [];
    const best = (same.length ? same : withCurrency).reduce((a, b) => (b.price < a.price ? b : a));
    return { price: best.price, currency: best.currency, source: "json-ld" };
  }
  // Price tags are often written for people (Shopify themes print "1.299,00"), so they are read as text.
  const metaPrice = parseAmount(metaContent(html, ["product:price:amount", "og:price:amount"]) ?? "", { currency: pageCurrency });
  if (metaPrice != null) return { price: metaPrice, currency: pageCurrency, source: "meta" };
  const itemprop = html.match(/itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["']([^"']+)["']|content\s*=\s*["']([^"']+)["'][^>]*itemprop\s*=\s*["']price["']/i);
  const microCurrency = currencyOf(metaContent(html, ["priceCurrency"]));
  const microPrice = parseAmount(itemprop?.[1] ?? itemprop?.[2] ?? "", { machine: true, currency: microCurrency });
  if (microPrice != null) return { price: microPrice, currency: microCurrency, source: "microdata" };
  return null;
}

/** The `.js` endpoint of a Shopify product page (`/products/<handle>.js`), or null for other pages. */
export function shopifyProductJsUrl(pageUrl) {
  let url;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  const match = url.pathname.match(/^((?:\/[a-z]{2}(?:-[a-z]{2})?)?(?:\/collections\/[^/]+)?\/products\/[^/.]+)\/?$/i);
  return match ? `${url.origin}${match[1]}.js` : null;
}

/** Lowest available price from a Shopify `/products/<handle>.js` answer (prices in cents), or null. */
export function priceFromShopifyJs(json) {
  const variants = Array.isArray(json?.variants) ? json.variants : [];
  const prices = variants.filter((v) => v.available !== false).map((v) => Number(v.price)).filter((p) => Number.isFinite(p) && p > 0);
  const all = prices.length ? prices : variants.map((v) => Number(v.price)).filter((p) => Number.isFinite(p) && p > 0);
  if (!all.length && Number(json?.price) > 0) all.push(Number(json.price));
  return all.length ? Math.round(Math.min(...all)) / 100 : null;
}

/**
 * Reads the price of a competitor's product page: the page's own price data first, then (for Shopify
 * stores) the product's `.js` endpoint, in the page's currency. One deadline covers both reads.
 * Resolves `{ price, currency }`; rejects with `PageFetchError` (readable message).
 */
export async function readCompetitorPrice(url, fetchPage, { currency = null, signal, deadline = Date.now() + FETCH_TIMEOUT_MS } = {}) {
  const page = await fetchPage(url, { signal, deadline });
  const found = priceFromHtml(page.body, currency);
  if (found) return { price: found.price, currency: found.currency };
  const jsUrl = shopifyProductJsUrl(page.url);
  if (jsUrl) {
    let price = null;
    try {
      const js = await fetchPage(jsUrl, { accept: "application/json", signal, deadline });
      price = priceFromShopifyJs(JSON.parse(js.body));
    } catch (error) {
      if (signal?.aborted || Date.now() >= deadline) throw error;
      // The page itself was readable; report the missing price below.
    }
    if (price != null) return { price, currency: currencyFromHtml(page.body) };
  }
  throw new PageFetchError("No price was found on this page.");
}
