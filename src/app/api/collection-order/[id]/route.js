import { collectionGid, proposeCollectionOrder, reorderHistory, saveCollectionOrder, savedCollections } from "@/lib/collection-optimizer";
import { missingFeature, requireFeature } from "@/lib/feature-gate";
import { HttpError } from "@/lib/http-error";
import { appRoute, readJson } from "@/lib/route";

const gidOf = (params) => {
  const gid = collectionGid(params.id);
  if (!gid) throw new HttpError("Collection not found.", 404);
  return gid;
};

// One manually sorted collection: its current order, the proposed one (with a reason per product) and
// its saved orders. `id` is the collection's numeric Shopify id. On a plan without the optimizer, only
// its saved orders (to undo), when it has any.
export const GET = appRoute(async ({ shop, session, params }) => {
  const gid = gidOf(params);
  const missing = missingFeature(shop, "collectionOrder");
  if (missing) {
    const history = await reorderHistory(shop.id, gid);
    if (!history.length) throw new HttpError(missing.error, 403, { upgrade: missing.upgrade });
    const title = (await savedCollections(shop.id)).find((c) => c.id === gid)?.title ?? "";
    return Response.json({ ...missing, collection: { id: gid, title }, proposal: null, current: null, history, currency: shop.currency });
  }
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
