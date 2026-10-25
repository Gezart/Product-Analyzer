import { adminGraphql } from "@/lib/admin";
import { appRoute } from "@/lib/route";

const QUERY = `#graphql
  query Collections($after: String) {
    collections(first: 250, after: $after, sortKey: TITLE) {
      nodes { id title }
      pageInfo { hasNextPage endCursor }
    }
  }`;

// Collections of the shop (id + title, up to 2,500), for the exclusion list in settings.
export const GET = appRoute(async ({ session }) => {
  const collections = [];
  let after = null;
  do {
    const data = await adminGraphql(session, QUERY, { after });
    collections.push(...data.collections.nodes);
    after = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null;
  } while (after && collections.length < 2_500);
  // `truncated`: very large shops; the form then keeps exclusions it can't see.
  return Response.json({ collections, truncated: after != null });
});
