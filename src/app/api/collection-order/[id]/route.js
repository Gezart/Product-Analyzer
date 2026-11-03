import { collectionGid, proposeCollectionOrder, reorderHistory, saveCollectionOrder } from "@/lib/collection-optimizer";
import { requireFeature } from "@/lib/feature-gate";
import { HttpError } from "@/lib/http-error";
import { appRoute, readJson } from "@/lib/route";

const gidOf = (params) => {
  const gid = collectionGid(params.id);
  if (!gid) throw new HttpError("Collection not found.", 404);
  return gid;
};

// One manually sorted collection: its current order, the proposed one (with a reason per product) and
// its saved orders. `id` is the collection's numeric Shopify id.
export const GET = appRoute(async ({ shop, session, params }) => {
  requireFeature(shop, "collectionOrder");
  const gid = gidOf(params);
  const [proposal, history] = await Promise.all([proposeCollectionOrder(shop, session, gid), reorderHistory(shop.id, gid)]);
  return Response.json({ ...proposal, history, currency: shop.currency });
});

// Saves the order the merchant confirmed. Body: { order: [product GIDs], expected: [the order the page showed] }.
export const POST = appRoute(async ({ request, shop, session, params }) => {
  requireFeature(shop, "collectionOrder");
  const gid = gidOf(params);
  const body = await readJson(request);
  return Response.json(await saveCollectionOrder(shop, session, gid, { order: body?.order, expected: body?.expected }));
});
