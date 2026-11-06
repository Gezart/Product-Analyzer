import { listBundles, startBundle } from "@/lib/bundles-shopify";
import { db } from "@/lib/db";
import { missingFeature, requireFeature, requireWithinLimit } from "@/lib/feature-gate";
import { appRoute, readJson } from "@/lib/route";

export const GET = appRoute(async ({ shop }) => {
  const data = await listBundles(shop);
  return Response.json({ ...data, currency: shop.currency, ...(missingFeature(shop, "bundles") ?? {}) });
});

// Body: { productGid, partnerGid, pct }: the stuck product, the product it's offered with, and the discount.
export const POST = appRoute(async ({ request, shop }) => {
  requireFeature(shop, "bundles");
  const body = await readJson(request);
  // Like a markdown: only on products the plan analyzes.
  const product = typeof body?.productGid === "string" ? await db().product.findFirst({ where: { shopId: shop.id, shopifyGid: body.productGid }, select: { id: true } }) : null;
  if (product) await requireWithinLimit(shop, product.id);
  const bundle = await startBundle(shop, body);
  return Response.json({ id: bundle.id }, { status: 201 });
});
