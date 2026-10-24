import type { Session } from "@shopify/shopify-api";
import { shopify } from "@/lib/shopify";

/** GraphQL Admin API request with the shop's offline session. Throws on GraphQL errors. */
export async function adminGraphql<T>(session: Session, query: string, variables?: Record<string, unknown>): Promise<T> {
  const client = new (shopify().clients.Graphql)({ session });
  const response = await client.request<T>(query, { variables });
  if (response.errors) throw new Error(`Admin API error: ${JSON.stringify(response.errors).slice(0, 500)}`);
  return response.data as T;
}
