// What a failed Admin API request means, for jobs that read page by page. Pure (no imports).
// `@shopify/shopify-api` throws GraphqlQueryError with the first error's message (e.g. "Throttled") and
// the codes in `body.errors.graphQLErrors[].extensions.code`; our `adminGraphql` throws the errors as JSON.

function codes(error) {
  const list = error?.body?.errors?.graphQLErrors ?? error?.response?.errors?.graphQLErrors ?? [];
  return (Array.isArray(list) ? list : []).map((e) => e?.extensions?.code).filter(Boolean);
}

/** Shopify is rate-limiting this app: wait and try again. */
export function isThrottled(error) {
  return codes(error).includes("THROTTLED") || /throttled/i.test(String(error?.message ?? ""));
}

/** The app lacks a scope for a field (e.g. `read_returns` not approved yet). */
export function isAccessDenied(error) {
  return codes(error).includes("ACCESS_DENIED") || /ACCESS_DENIED|access denied|access scope/i.test(String(error?.message ?? ""));
}
