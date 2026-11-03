import { openaiConfigured } from "@/lib/ai/openai-image";
import { createPhotoDraft } from "@/lib/ai/photos";
import { validatePhotoRequest } from "@/lib/ai-photo";
import { db } from "@/lib/db";
import { requireFeature, requireWithinLimit } from "@/lib/feature-gate";
import { HttpError } from "@/lib/http-error";
import { appRoute, readJson } from "@/lib/route";

// "Create photo with AI". Body: { mediaId, style: "white" | "scene", scene? }. Makes a draft from one of
// the product's photos for the merchant to look at; nothing goes to Shopify until it's added.
export const POST = appRoute(async ({ request, shop, session, params }) => {
  requireFeature(shop, "aiPhotos");
  if (!openaiConfigured()) throw new HttpError("Photos with AI aren't set up for this app yet.", 409);
  const product = await db().product.findFirst({ where: { id: params.id, shopId: shop.id } });
  if (!product) throw new HttpError("Product not found.", 404);
  await requireWithinLimit(shop, product.id);
  const input = validatePhotoRequest(await readJson(request));
  if (input.error) throw new HttpError(input.error, 400);
  return Response.json(await createPhotoDraft(shop, session, product, input));
});
