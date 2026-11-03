import { marketGaps } from "@/lib/competitor-prices";
import { db } from "@/lib/db";
import { appRoute } from "@/lib/route";
import { latestScores } from "@/lib/scores";
import { sanitizeThresholds } from "@/lib/scoring";

// Every product with its latest status, money at stake, days of stock and, with competitor links, how
// far its price is from the market price (for the product list).
export const GET = appRoute(async ({ shop }) => {
  const [products, gaps] = await Promise.all([latestScores(shop.id, { unscored: true }), marketGaps(shop)]);
  const settings = gaps.size ? await db().settings.findUnique({ where: { shopId: shop.id }, select: { thresholds: true } }) : null;
  return Response.json({
    currency: shop.currency,
    marketAbove: gaps.size ? sanitizeThresholds(settings?.thresholds).marketAbove : null,
    products: products.map(({ computedAt, ...p }) => ({ ...p, marketGap: gaps.get(p.productId) ?? null })),
  });
});
