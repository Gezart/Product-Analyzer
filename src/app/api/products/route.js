import { appRoute } from "@/lib/route";
import { latestScores } from "@/lib/scores";

// Every product with its latest status, money at stake and days of stock (for the product list).
export const GET = appRoute(async ({ shop }) => {
  const products = await latestScores(shop.id, { unscored: true });
  return Response.json({ currency: shop.currency, products: products.map(({ computedAt, ...p }) => p) });
});
