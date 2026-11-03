import { uploadOwnPhoto } from "@/lib/ai/photos";
import { MAX_PHOTO_BYTES } from "@/lib/ai-photo";
import { db } from "@/lib/db";
import { requireFeature, requireWithinLimit } from "@/lib/feature-gate";
import { HttpError } from "@/lib/http-error";
import { appRoute } from "@/lib/route";

// The merchant uploads a photo of the product (multipart, field "file"), e.g. when it has none yet:
// it's added to the product in Shopify, undoable from the history.
export const POST = appRoute(async ({ request, shop, params }) => {
  requireFeature(shop, "fixCenter");
  const product = await db().product.findFirst({ where: { id: params.id, shopId: shop.id } });
  if (!product) throw new HttpError("Product not found.", 404);
  await requireWithinLimit(shop, product.id);
  // Refused before reading the body (form overhead allowed for).
  if (Number(request.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES + 64 * 1024) throw new HttpError("This photo is too large (over 20 MB).", 413);
  const form = await request.formData().catch(() => null);
  if (!form) throw new HttpError("Choose a photo to upload.", 400);
  return Response.json(await uploadOwnPhoto(shop, product, form.get("file")));
});
