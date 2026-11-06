import { db } from "@/lib/db";
import { requireFeature } from "@/lib/feature-gate";
import { pageBuilderOf, validatePageBuilder } from "@/lib/page-builder";
import { pageBuilderAnswer as answer } from "@/lib/page-builder-answer";
import { savePageBuilder } from "@/lib/page-builder-shopify";
import { appRoute, readJson } from "@/lib/route";

export const GET = appRoute(async ({ shop }) => {
  const row = await db().settings.findUnique({ where: { shopId: shop.id }, select: { pageBuilder: true } });
  return answer(shop, pageBuilderOf(row?.pageBuilder));
});

// Publishes the blocks and the product page to the storefront first, then stores them: a save Shopify refuses changes nothing.
export const PUT = appRoute(async ({ request, shop, session }) => {
  requireFeature(shop, "pageBuilder");
  const result = validatePageBuilder(await readJson(request));
  if (!result.ok) return Response.json({ errors: result.errors }, { status: 400 });
  await savePageBuilder(shop, session, result.value);
  return answer(shop, result.value);
});
