import { orderCollections, savedCollections } from "@/lib/collection-optimizer";
import { missingFeature } from "@/lib/feature-gate";
import { appRoute } from "@/lib/route";

// The shop's collections for the Collection Optimizer: the manually sorted ones can be reordered. On a
// plan without it, only collections with saved orders are listed, so those can still be undone.
export const GET = appRoute(async ({ shop, session }) => {
  const missing = missingFeature(shop, "collectionOrder");
  if (missing) return Response.json({ ...missing, collections: await savedCollections(shop.id), automatic: 0, truncated: false });
  const { collections, truncated } = await orderCollections(session);
  return Response.json({ collections: collections.filter((c) => c.manual), automatic: collections.filter((c) => !c.manual).length, truncated });
});
