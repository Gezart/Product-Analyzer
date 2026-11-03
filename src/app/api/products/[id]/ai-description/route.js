import { AiError, claudeConfigured, writeDescription } from "@/lib/ai/claude";
import { aiAllowance, recordAiCost, releaseAiText, reserveAiText } from "@/lib/ai/usage";
import { descriptionPrompt, draftFromAnswer, MAX_IMAGES } from "@/lib/ai-text";
import { db } from "@/lib/db";
import { requireFeature, requireWithinLimit } from "@/lib/feature-gate";
import { readLiveProduct } from "@/lib/fix-shopify";
import { HttpError } from "@/lib/http-error";
import { appRoute } from "@/lib/route";

// "Write with AI": a draft description, SEO title and meta description for the merchant to check,
// finish ([fill in: …]) and apply in the fix center. Nothing is written to Shopify here.
export const POST = appRoute(async ({ shop, session, params }) => {
  requireFeature(shop, "aiDescriptions");
  if (!claudeConfigured()) throw new HttpError("Writing with AI isn't set up for this app yet.", 409);
  const product = await db().product.findFirst({ where: { id: params.id, shopId: shop.id }, include: { variants: { select: { options: true } } } });
  if (!product) throw new HttpError("Product not found.", 404);
  await requireWithinLimit(shop, product.id);

  const [live, diagnosis] = await Promise.all([
    readLiveProduct(session, product.shopifyGid),
    db().diagnosis.findFirst({ where: { productId: product.id }, orderBy: { createdAt: "desc" }, select: { reasons: true } }),
  ]);
  if (!live) throw new HttpError("Product no longer exists in Shopify.", 404);
  const imageUrls = live.media.filter((m) => m.type === "IMAGE" && m.previewUrl).slice(0, MAX_IMAGES).map((m) => m.previewUrl);
  const prompt = descriptionPrompt({ ...product, title: live.title }, (diagnosis?.reasons ?? []).map((r) => r.code));

  const month = await reserveAiText(shop);
  let draft = null;
  try {
    const { json, usage } = await writeDescription({ prompt, imageUrls });
    await recordAiCost(shop, month, usage);
    draft = draftFromAnswer(json);
    if (!draft) throw new AiError("The AI's answer couldn't be used. Try again.");
  } catch (error) {
    // No draft, no use taken; the tokens a failed answer spent are still counted.
    if (error?.usage) await recordAiCost(shop, month, error.usage);
    await releaseAiText(shop, month);
    if (error instanceof AiError) throw new HttpError(error.message, error.status);
    throw error;
  }
  return Response.json({ draft, ai: await aiAllowance(shop) });
});
