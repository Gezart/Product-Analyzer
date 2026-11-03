import { addPhotoDraft } from "@/lib/ai/photos";
import { db } from "@/lib/db";
import { requireFeature, requireWithinLimit } from "@/lib/feature-gate";
import { HttpError } from "@/lib/http-error";
import { appRoute, readJson } from "@/lib/route";

// The merchant approves an AI photo: it's added to the product in Shopify, undoable from the history.
// Body: { diagnosisId? }.
export const POST = appRoute(async ({ request, shop, params }) => {
  requireFeature(shop, "aiPhotos");
  const draft = await db().aiPhotoDraft.findFirst({ where: { id: params.draftId, shopId: shop.id }, select: { productId: true } });
  if (!draft) throw new HttpError("This AI photo wasn't found (drafts are kept for a day).", 404);
  await requireWithinLimit(shop, draft.productId);
  const body = await readJson(request);
  const diagnosisId = typeof body?.diagnosisId === "string" ? body.diagnosisId : undefined;
  return Response.json(await addPhotoDraft(shop, params.draftId, { diagnosisId }));
});
