import { shopify } from "@/lib/shopify";

/**
 * GraphQL Admin API request with the shop's offline session. Network errors and rate-limited (429) or
 * unavailable (503) answers are retried twice — safe because every write sets absolute values; a
 * THROTTLED GraphQL error (HTTP 200) is not retried. GraphQL errors throw.
 */
export async function adminGraphql(session, query, variables) {
  const client = new (shopify().clients.Graphql)({ session });
  const response = await client.request(query, { variables, retries: 2 });
  if (response.errors) throw new Error(`Admin API error: ${JSON.stringify(response.errors).slice(0, 500)}`);
  return response.data;
}
