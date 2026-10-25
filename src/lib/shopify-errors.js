import { GraphqlQueryError, HttpMaxRetriesError, HttpRequestError, HttpResponseError } from "@shopify/shopify-api";

/**
 * What to tell the merchant when a Shopify call failed (unreachable, overloaded, or the request was
 * refused), or null for any other error.
 */
export function shopifyFailure(error) {
  if (error instanceof GraphqlQueryError) return `Shopify refused the request: ${error.message.slice(0, 300)}`;
  if (error instanceof HttpRequestError || error instanceof HttpResponseError || error instanceof HttpMaxRetriesError) {
    return "Couldn't reach Shopify. Try again in a moment.";
  }
  return null;
}
