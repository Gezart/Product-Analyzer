import { collectionGid, proposeCollectionOrder } from "@/lib/collection-optimizer";
import { requireFeature } from "@/lib/feature-gate";
import { HttpError } from "@/lib/http-error";
import { appRoute } from "@/lib/route";

// One manually sorted collection: its current order and the proposed one, with a reason per product.
// `id` is the collection's numeric Shopify id.
export const GET = appRoute(async ({ shop, session, params }) => {
  requireFeature(shop, "collectionOrder");
  const gid = collectionGid(params.id);
  if (!gid) throw new HttpError("Collection not found.", 404);
  return Response.json({ ...(await proposeCollectionOrder(shop, session, gid)), currency: shop.currency });
});
