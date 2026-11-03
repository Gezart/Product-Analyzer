// Google Merchant Center price benchmarks — pure (no imports) so node:test can load it.
// Field names follow the Merchant API discovery document (reports_v1, price_competitiveness_product_view).

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/content";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const MERCHANT_API = "https://merchantapi.googleapis.com";

/** Benchmarks older than this (the nightly read keeps failing) are no longer used. */
export const FRESH_MS = 3 * 24 * 60 * 60 * 1000;

/** Benchmarks count only while the connection works and the last read is under 3 days old. */
export function isFresh(status, syncedAt, now = Date.now()) {
  return status === "connected" && syncedAt instanceof Date && now - syncedAt.getTime() < FRESH_MS;
}

/** Google's report query: each offer's price and the price benchmark in each country. */
export const BENCHMARK_QUERY =
  "SELECT id, offer_id, price, benchmark_price, report_country_code FROM price_competitiveness_product_view";

/** The consent screen link: offline access (a refresh token), always asking, so a reconnect gets one too. */
export function googleAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

/**
 * Offer IDs written by Shopify's Google & YouTube channel: `shopify_<COUNTRY>_<productId>_<variantId>`.
 * Returns the Shopify IDs as GIDs, or null for offers from elsewhere.
 */
export function parseOfferId(offerId) {
  const m = /^shopify_([a-z]{2})_(\d+)_(\d+)$/i.exec(String(offerId ?? "").trim());
  if (!m) return null;
  return { country: m[1].toUpperCase(), productGid: `gid://shopify/Product/${m[2]}`, variantGid: `gid://shopify/ProductVariant/${m[3]}` };
}

/** A Merchant API `Price` ({ amountMicros, currencyCode }) as `{ amount, currency }`, or null. */
export function fromPrice(price) {
  const micros = Number(price?.amountMicros);
  const currency = typeof price?.currencyCode === "string" ? price.currencyCode.toUpperCase() : null;
  if (!Number.isFinite(micros) || micros <= 0 || !currency) return null;
  return { amount: Math.round(micros / 10_000) / 100, currency };
}

/**
 * Report rows as benchmarks: `{ offerId, country, price, benchmark, currency }`. Rows without a benchmark,
 * or whose price and benchmark are in different currencies, are skipped (never compared across currencies).
 */
export function benchmarkRows(results) {
  const rows = [];
  for (const r of results ?? []) {
    const v = r?.priceCompetitivenessProductView;
    if (!v?.offerId) continue;
    const price = fromPrice(v.price);
    const benchmark = fromPrice(v.benchmarkPrice);
    if (!price || !benchmark || price.currency !== benchmark.currency) continue;
    rows.push({ offerId: v.offerId, country: String(v.reportCountryCode ?? "").toUpperCase() || null, price: price.amount, benchmark: benchmark.amount, currency: price.currency });
  }
  return rows;
}

/**
 * A product's Google market price from its variants' benchmarks in the shop's currency: the benchmark of
 * the offer priced closest to `price` (the product's price, its cheapest variant; the cheaper offer on a
 * tie). Without `price`, the cheapest offer. `{ median, count, country, price, source }` or null.
 */
export function productBenchmark(rows, currency, price = null) {
  const same = (rows ?? []).filter((r) => currency && r.currency === currency && Number(r.benchmark) > 0 && Number(r.price) > 0);
  if (!same.length) return null;
  const distance = (r) => (price > 0 ? Math.abs(Number(r.price) - price) : Number(r.price));
  const best = same.reduce((a, b) => (distance(b) < distance(a) || (distance(b) === distance(a) && Number(b.price) < Number(a.price)) ? b : a));
  return { median: Number(best.benchmark), count: same.length, country: best.country, price: Number(best.price), source: "google" };
}
