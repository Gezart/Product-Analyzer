import { addLink, listLinks, MAX_LINKS, removeLink } from "@/lib/competitor-prices";
import { db } from "@/lib/db";
import { requireFeature, requireWithinLimit } from "@/lib/feature-gate";
import { HttpError } from "@/lib/http-error";
import { competitorSummary, gapToMarket } from "@/lib/market-price";
import { FEATURE_PLAN, hasFeature } from "@/lib/plans";
import { appRoute, readJson } from "@/lib/route";

/** The links, the market price they give, and how far the product's price is from it. */
async function overview(shop, productId, links) {
  const product = await db().product.findFirst({ where: { id: productId, shopId: shop.id }, select: { price: true } });
  if (!product) throw new HttpError("Product not found.", 404);
  const competitors = competitorSummary(links, shop.currency);
  const price = Number(product.price);
  return { links, max: MAX_LINKS, currency: shop.currency, price, competitors, gap: gapToMarket(price, competitors.median) };
}

export const GET = appRoute(async ({ shop, params }) => {
  if (!hasFeature(shop.plan, "marketPrice")) return Response.json({ ...(await overview(shop, params.id, [])), upgrade: FEATURE_PLAN.marketPrice });
  return Response.json(await overview(shop, params.id, await listLinks(shop.id, params.id)));
});

// Body: { url } — adds a link and reads its price right away (up to 10 seconds).
export const POST = appRoute(async ({ request, shop, params }) => {
  requireFeature(shop, "marketPrice");
  const product = await db().product.findFirst({ where: { id: params.id, shopId: shop.id }, select: { id: true } });
  if (!product) throw new HttpError("Product not found.", 404);
  await requireWithinLimit(shop, params.id);
  const body = await readJson(request);
  return Response.json(await overview(shop, params.id, await addLink(shop.id, params.id, body?.url)));
});

// Body: { linkId }
export const DELETE = appRoute(async ({ request, shop, params }) => {
  requireFeature(shop, "marketPrice");
  const body = await readJson(request);
  return Response.json(await overview(shop, params.id, await removeLink(shop.id, params.id, body?.linkId)));
});
