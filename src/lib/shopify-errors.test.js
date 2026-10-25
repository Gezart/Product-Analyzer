import assert from "node:assert/strict";
import { test } from "node:test";
import { GraphqlQueryError, HttpRequestError, HttpThrottlingError } from "@shopify/shopify-api";
import { shopifyFailure } from "./shopify-errors.js";

test("Shopify failures get a readable message; other errors don't", () => {
  assert.equal(shopifyFailure(new HttpRequestError("fetch failed")), "Couldn't reach Shopify. Try again in a moment.");
  assert.equal(shopifyFailure(new HttpThrottlingError({ message: "Throttled", code: 429 })), "Couldn't reach Shopify. Try again in a moment.");
  assert.match(shopifyFailure(new GraphqlQueryError({ message: "Access denied" })), /^Shopify refused the request: Access denied/);
  assert.equal(shopifyFailure(new Error("database down")), null);
});
