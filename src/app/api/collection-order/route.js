import { latestSaves, orderCollections, savedCollections } from "@/lib/collection-optimizer";
import { missingFeature } from "@/lib/feature-gate";
import { appRoute } from "@/lib/route";

/** Automatically sorted collections shown (greyed out) in the list, so the merchant sees why they're missing. */
const AUTOMATIC_SHOWN = 20;

// The shop's collections for the Collection Optimizer: the manually sorted ones can be reordered, each
// with its latest saved order. On a plan without it, only collections with saved orders are listed, so
// those can still be undone.
export const GET = appRoute(async ({ shop, session }) => {
  const missing = missingFeature(shop, "collectionOrder");
  const latest = await latestSaves(shop.id);
  const withLatest = (c) => ({ ...c, latest: latest.get(c.id) ?? null });
  if (missing) {
    return Response.json({ ...missing, collections: (await savedCollections(shop.id)).map(withLatest), automatic: 0, automaticCollections: [], truncated: false });
  }
  const { collections, truncated } = await orderCollections(session);
  const automatic = collections.filter((c) => !c.manual);
  return Response.json({
    collections: collections.filter((c) => c.manual).map(withLatest),
    automatic: automatic.length,
    automaticCollections: automatic.slice(0, AUTOMATIC_SHOWN).map(({ id, title, count }) => ({ id, title, count })),
    truncated,
  });
});
