// Reads a product's price from a competitor's product page. Pure (no imports) so node:test can load it.
// Sources, in order: schema.org Product data (JSON-LD), then price meta tags (Open Graph / product:),
// then microdata. The lowest offer is used, like our own price is the cheapest variant.

/** A price written as text ("1299.00", "1.299,00", "1,299.00", "€ 49,90") as a number, or null. */
export function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string" || /-\s*[\d.,]/.test(value)) return null;
  let s = value.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // The later separator is the decimal one.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "49,90" is a decimal comma; "1,299" (three digits after) is a thousands separator.
    s = /,\d{3}$/.test(s) && s.split(",").length === 2 && s.length > 4 ? s.replace(",", "") : s.replace(/,/g, ".");
    if ((s.match(/\./g) ?? []).length > 1) return null;
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\.(?=\d{3}(\.|$))/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
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

/** Every Product object in the page's JSON-LD blocks (inside @graph and arrays too). */
function jsonLdProducts(html) {
  const products = [];
  const blocks = html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const type = [].concat(node["@type"] ?? []);
    if (type.some((t) => String(t).toLowerCase() === "product" || String(t).toLowerCase() === "productgroup")) products.push(node);
    if (node["@graph"]) walk(node["@graph"]);
    if (node.hasVariant) walk(node.hasVariant);
  };
  for (const [, body] of blocks) {
    try {
      walk(JSON.parse(body.trim()));
    } catch {
      // Broken JSON-LD is common; other sources are tried.
    }
  }
  return products;
}

/** Offers of a JSON-LD product as `{ price, currency }`, skipping offers marked out of stock when others exist. */
function offerPrices(product) {
  const offers = [].concat(product.offers ?? []);
  const found = [];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const currency = currencyOf(offer.priceCurrency) ?? currencyOf(offer.priceSpecification?.priceCurrency);
    const inStock = !String(offer.availability ?? "").toLowerCase().includes("outofstock");
    for (const key of ["price", "lowPrice"]) {
      const price = parseAmount(offer[key] ?? (key === "price" ? offer.priceSpecification?.price : undefined));
      if (price != null) found.push({ price, currency, inStock });
    }
  }
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

/**
 * The lowest price on a product page and its currency: `{ price, currency, source }`, or null when the
 * page has no price we can trust. `currency` may be null when the page doesn't say.
 */
export function priceFromHtml(html) {
  if (typeof html !== "string" || !html) return null;
  const fromLd = jsonLdProducts(html).flatMap(offerPrices);
  if (fromLd.length) {
    const best = fromLd.reduce((a, b) => (b.price < a.price ? b : a));
    const currency = best.currency ?? fromLd.find((p) => p.currency)?.currency ?? currencyOf(metaContent(html, ["product:price:currency", "og:price:currency"]));
    return { price: best.price, currency, source: "json-ld" };
  }
  const metaPrice = parseAmount(metaContent(html, ["product:price:amount", "og:price:amount"]) ?? "");
  if (metaPrice != null) {
    return { price: metaPrice, currency: currencyOf(metaContent(html, ["product:price:currency", "og:price:currency"])), source: "meta" };
  }
  const itemprop = html.match(/itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["']([^"']+)["']|content\s*=\s*["']([^"']+)["'][^>]*itemprop\s*=\s*["']price["']/i);
  const microPrice = parseAmount(itemprop?.[1] ?? itemprop?.[2] ?? "");
  if (microPrice != null) return { price: microPrice, currency: currencyOf(metaContent(html, ["priceCurrency"])), source: "microdata" };
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
