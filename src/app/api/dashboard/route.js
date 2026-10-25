import { summarize } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { appRoute } from "@/lib/route";
import { latestScores } from "@/lib/scores";

// Catalog health from each product's latest score.
export const GET = appRoute(async ({ shop }) => {
  const scores = await latestScores(shop.id);
  const scoredAt = scores.reduce((max, r) => (!max || r.computedAt > max ? r.computedAt : max), null);
  // Scoring writes a row for every product that isn't deleted, so with no scores the analysis is only
  // "done" when the import finished and there is no such product (an empty store).
  const imported =
    scoredAt != null ||
    ((await db().syncState.findUnique({ where: { shopId_resource: { shopId: shop.id, resource: "orders" } } }))?.status === "done" &&
      (await db().product.count({ where: { shopId: shop.id, status: { not: "DELETED" } } })) === 0);
  return Response.json({ currency: shop.currency, plan: shop.plan, scoredAt, imported, ...summarize(scores) });
});
