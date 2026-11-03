import { undoCollectionOrder } from "@/lib/collection-optimizer";
import { appRoute, readJson } from "@/lib/route";

// Puts a collection back in the order it had before a save. Body: { force?: boolean } — force
// overwrites changes made to the order since. Open on every plan, like undoing a fix.
export const POST = appRoute(async ({ request, shop, session, params }) => {
  const body = await readJson(request);
  return Response.json(await undoCollectionOrder(shop, session, params.reorderId, { force: body?.force === true }));
});
