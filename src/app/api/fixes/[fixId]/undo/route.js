import { undoFix } from "@/lib/fix-center";
import { appRoute, readJson } from "@/lib/route";

// Body: { force?: boolean } — force overwrites changes made to the product after the fix.
export const POST = appRoute(async ({ request, shop, params }) => {
  const { fixId } = params;
  const body = await readJson(request);
  return Response.json(await undoFix(shop.id, fixId, { force: body?.force === true }));
});
