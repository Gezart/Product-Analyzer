import assert from "node:assert/strict";
import { test } from "node:test";
import { isAccessDenied, isThrottled } from "./graphql-errors.js";

/** The shape `@shopify/shopify-api` throws for GraphQL errors (GraphqlQueryError). */
const clientError = (message, code) => Object.assign(new Error(message), { body: { errors: { graphQLErrors: [{ message, extensions: { code } }] } } });

test("throttling, as the Shopify client and our own helper report it", () => {
  assert.equal(isThrottled(clientError("Throttled", "THROTTLED")), true);
  assert.equal(isThrottled(new Error('Admin API error: [{"message":"Throttled","extensions":{"code":"THROTTLED"}}]')), true);
  assert.equal(isThrottled(clientError("Query cost is 2592, which exceeds the single query max cost limit (1000)", "MAX_COST_EXCEEDED")), false);
  assert.equal(isThrottled(new Error("fetch failed")), false);
  assert.equal(isThrottled(undefined), false);
});

test("a missing scope, as the Shopify client reports it", () => {
  assert.equal(isAccessDenied(clientError("Access denied for returns field. Required access: `read_returns` access scope.", "ACCESS_DENIED")), true);
  assert.equal(isAccessDenied(clientError("Throttled", "THROTTLED")), false);
});
