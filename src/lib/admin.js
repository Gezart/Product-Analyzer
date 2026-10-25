import { shopify } from "@/lib/shopify";

/**
 * GraphQL Admin API request with the shop's offline session. Rate-limited (429) and unavailable (503)
 * answers are retried twice; GraphQL errors throw.
 */
export async function adminGraphql(session, query, variables) {
  const client = new (shopify().clients.Graphql)({ session });
  const response = await client.request(query, { variables, retries: 2 });
  if (response.errors) throw new Error(`Admin API error: ${JSON.stringify(response.errors).slice(0, 500)}`);
  return response.data;
}
