import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { proxySignature, verifyProxyRequest } from "./app-proxy.js";

const secret = "hush";
const now = 1_317_327_600;
const signed = (pairs) => {
  const params = new URLSearchParams(pairs);
  params.append("signature", proxySignature(params, secret));
  return params;
};

test("the signature covers every other parameter, sorted, with repeated keys joined by commas", () => {
  const params = new URLSearchParams("extra=1&extra=2&shop=some-shop.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fawesome_reviews&timestamp=1317327555");
  const message = "extra=1,2logged_in_customer_id=1path_prefix=/apps/awesome_reviewsshop=some-shop.myshopify.comtimestamp=1317327555";
  assert.equal(proxySignature(params, secret), createHmac("sha256", secret).update(message).digest("hex"));
});

test("a proxied request is trusted only with a valid, recent signature", () => {
  const good = signed([["shop", "some-shop.myshopify.com"], ["logged_in_customer_id", ""], ["path_prefix", "/apps/unstuck"], ["timestamp", String(now - 60)]]);
  assert.deepEqual(verifyProxyRequest(good, secret, now), { ok: true, shop: "some-shop.myshopify.com", customerId: null });
  // Changed after signing: another shop.
  const tampered = new URLSearchParams(good);
  tampered.set("shop", "other-shop.myshopify.com");
  assert.deepEqual(verifyProxyRequest(tampered, secret, now), { ok: false, reason: "bad signature" });
  // Signed with another secret.
  assert.equal(verifyProxyRequest(good, "other", now).reason, "bad signature");
  // Too old (replayed), or no signature at all.
  assert.equal(verifyProxyRequest(good, secret, now + 20 * 60).reason, "expired");
  assert.equal(verifyProxyRequest(new URLSearchParams("shop=a.myshopify.com"), secret, now).reason, "missing signature");
  // A shop that isn't a myshopify domain, even signed.
  assert.equal(verifyProxyRequest(signed([["shop", "evil.example.com"], ["timestamp", String(now)]]), secret, now).reason, "bad shop");
  // A logged-in customer is passed on.
  assert.equal(verifyProxyRequest(signed([["shop", "a.myshopify.com"], ["logged_in_customer_id", "42"], ["timestamp", String(now)]]), secret, now).customerId, "42");
});
