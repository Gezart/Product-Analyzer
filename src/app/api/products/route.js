import { marketGaps } from "@/lib/competitor-prices";
import { db } from "@/lib/db";
import { appRoute } from "@/lib/route";
import { latestScores } from "@/lib/scores";
import { sanitizeThresholds } from "@/lib/scoring";

// Every product with its latest status, money at stake, days of stock and, with competitor links, how
// far its price is from the market price (for the product list); also its last change (the latest
// applied fix and how its rescue plan judged it) and a running markdown's step.
export const GET = appRoute(async ({ shop }) => {
  const [products, gaps, fixes, plans, markdowns] = await Promise.all([
    latestScores(shop.id, { unscored: true }),
    marketGaps(shop),
    db().fix.findMany({
      where: { product: { shopId: shop.id }, status: "applied" },
      orderBy: { appliedAt: { sort: "desc", nulls: "last" } },
      distinct: ["productId"],
      select: { id: true, productId: true, type: true, appliedAt: true },
    }),
    db().rescuePlan.findMany({ where: { product: { shopId: shop.id } }, orderBy: { startedAt: "desc" }, distinct: ["productId"], select: { productId: true, verdict: true, fixIds: true } }),
    db().markdownPlan.findMany({ where: { product: { shopId: shop.id }, status: { in: ["active", "paused"] } }, select: { productId: true, currentStep: true, status: true } }),
  ]);
  const settings = gaps.size ? await db().settings.findUnique({ where: { shopId: shop.id }, select: { thresholds: true } }) : null;
  const planOf = new Map(plans.map((p) => [p.productId, p]));
  const lastChange = new Map(
    fixes.map((f) => {
      const plan = planOf.get(f.productId);
      const verdict = plan?.fixIds.includes(f.id) ? (plan.verdict ?? "measuring") : null;
      return [f.productId, { type: f.type, at: f.appliedAt, verdict }];
    }),
  );
  // `step` null while the first price change isn't confirmed yet (currentStep -1).
  const markdownOf = new Map(markdowns.map((m) => [m.productId, { step: m.currentStep >= 0 ? m.currentStep + 1 : null, paused: m.status === "paused" }]));
  return Response.json({
    currency: shop.currency,
    marketAbove: gaps.size ? sanitizeThresholds(settings?.thresholds).marketAbove : null,
    products: products.map(({ computedAt, ...p }) => ({
      ...p,
      marketGap: gaps.get(p.productId) ?? null,
      lastChange: lastChange.get(p.productId) ?? null,
      markdown: markdownOf.get(p.productId) ?? null,
    })),
  });
});
