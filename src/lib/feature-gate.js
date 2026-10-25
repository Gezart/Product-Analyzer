import { db } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { FEATURE_PLAN, getPlan, hasFeature, PLANS, productLimit } from "@/lib/plans";

const LABEL = { fixCenter: "The fix center", markdown: "Markdown", compare: "Compare", reports: "The monthly report" };

/** Throws a 403 (with the plan to upgrade to) when the shop's plan doesn't include `feature`. */
export function requireFeature(shop, feature) {
  if (hasFeature(shop.plan, feature)) return;
  const plan = getPlan(FEATURE_PLAN[feature]);
  throw new HttpError(`${LABEL[feature]} is included from the ${plan.name} plan.`, 403, { upgrade: plan.id });
}

/**
 * The plan to upgrade to when the product is beyond the plan's product limit — its latest score says
 * so, or it hasn't been scored yet (new since the last run) while the plan's places are all taken —
 * or null when it's within the limit.
 */
export async function overLimitUpgrade(shop, productId) {
  const score = await db().productScore.findFirst({
    where: { productId, product: { shopId: shop.id } },
    orderBy: { computedAt: "desc" },
    select: { status: true },
  });
  if (score && score.status !== "over_limit") return null;
  if (!score) {
    const limit = productLimit(shop.plan);
    if (limit === Infinity) return null;
    const [{ analyzed }] = await db().$queryRaw`
      SELECT count(*)::int AS "analyzed" FROM "products" p
      CROSS JOIN LATERAL (SELECT x."status" FROM "product_scores" x WHERE x."product_id" = p."id" ORDER BY x."computed_at" DESC LIMIT 1) s
      WHERE p."shop_id" = ${shop.id} AND p."status" = 'ACTIVE' AND s."status" NOT IN ('over_limit', 'excluded')`;
    if (analyzed < limit) return null;
  }
  const index = PLANS.findIndex((p) => p.id === shop.plan);
  return (PLANS[index < 0 ? 1 : index + 1] ?? PLANS[1]).id;
}

export const OVER_LIMIT_MESSAGE = "This product is beyond the number of products your plan analyzes.";

/** Throws a 403 (with the plan to upgrade to) when the product is beyond the plan's product limit. */
export async function requireWithinLimit(shop, productId) {
  const upgrade = await overLimitUpgrade(shop, productId);
  if (upgrade) throw new HttpError(OVER_LIMIT_MESSAGE, 403, { upgrade });
}
