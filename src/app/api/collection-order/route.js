import { orderCollections } from "@/lib/collection-optimizer";
import { requireFeature } from "@/lib/feature-gate";
import { appRoute } from "@/lib/route";

// The shop's collections for the Collection Optimizer: the manually sorted ones can be reordered.
export const GET = appRoute(async ({ shop, session }) => {
  requireFeature(shop, "collectionOrder");
  const { collections, truncated } = await orderCollections(session);
  return Response.json({ collections: collections.filter((c) => c.manual), automatic: collections.filter((c) => !c.manual).length, truncated });
});
