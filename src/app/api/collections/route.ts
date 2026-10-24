import { adminGraphql } from "@/lib/admin";
import { authenticate, AuthError } from "@/lib/auth";

type CollectionsQuery = {
  collections: { nodes: { id: string; title: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};

const QUERY = `#graphql
  query Collections($after: String) {
    collections(first: 250, after: $after, sortKey: TITLE) {
      nodes { id title }
      pageInfo { hasNextPage endCursor }
    }
  }`;

// All collections of the shop (id + title), for the exclusion list in settings.
export async function GET(request: Request) {
  try {
    const { session } = await authenticate(request);
    const collections: { id: string; title: string }[] = [];
    let after: string | null = null;
    do {
      const data: CollectionsQuery = await adminGraphql<CollectionsQuery>(session, QUERY, { after });
      collections.push(...data.collections.nodes);
      after = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null;
    } while (after && collections.length < 2_500);
    return Response.json({ collections });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
