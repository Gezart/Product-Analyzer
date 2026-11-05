// App proxy requests (the storefront calls /apps/unstuck/…, Shopify forwards them here with a signature).
// Relative imports only, so node:test can load it.

import { createHmac, timingSafeEqual } from "node:crypto";

/** How old a proxied request may be (seconds): stops a captured URL from being replayed later. */
export const MAX_AGE_SECONDS = 15 * 60;

/**
 * Shopify's signature over the other query parameters: each `key=value` (several values of one key
 * joined by ","), sorted, concatenated without separators, HMAC-SHA256 hex with the app's secret.
 */
export function proxySignature(searchParams, secret) {
  const keys = [...new Set([...searchParams.keys()])].filter((k) => k !== "signature").sort();
  const message = keys.map((k) => `${k}=${searchParams.getAll(k).join(",")}`).join("");
  return createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * Whether a proxied request really comes from Shopify and is recent: `{ ok: true, shop, customerId }`
 * or `{ ok: false, reason }`. `now` in seconds.
 */
export function verifyProxyRequest(searchParams, secret, now = Math.floor(Date.now() / 1000)) {
  const signature = searchParams.get("signature") ?? "";
  if (!/^[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: "missing signature" };
  const expected = Buffer.from(proxySignature(searchParams, secret), "hex");
  const given = Buffer.from(signature, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad signature" };
  const timestamp = Number(searchParams.get("timestamp"));
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_AGE_SECONDS) return { ok: false, reason: "expired" };
  const shop = searchParams.get("shop") ?? "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) return { ok: false, reason: "bad shop" };
  return { ok: true, shop, customerId: searchParams.get("logged_in_customer_id") || null };
}
