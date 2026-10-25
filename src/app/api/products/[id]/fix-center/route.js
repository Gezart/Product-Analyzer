import { db } from "@/lib/db";
import { OVER_LIMIT_MESSAGE, overLimitUpgrade } from "@/lib/feature-gate";
import { manualCollections, readLiveProduct } from "@/lib/fix-shopify";
import { FIX_HINTS } from "@/lib/fixes";
import { FEATURE_PLAN, hasFeature } from "@/lib/plans";
import { appRoute } from "@/lib/route";

// Everything the fix center edits, read live from Shopify, plus hints from the latest diagnosis and the fix history.
export const GET = appRoute(async ({ shop, session, params }) => {
  const { id } = params;
  // History and undo stay available on every plan; applying needs the plan (and the product within its limit).
  const overLimit = await overLimitUpgrade(shop, id);
  const upgrade = !hasFeature(shop.plan, "fixCenter")
    ? { plan: FEATURE_PLAN.fixCenter, reason: "Applying fixes is included from the Starter plan." }
    : overLimit
      ? { plan: overLimit, reason: OVER_LIMIT_MESSAGE }
      : null;
  const product = await db().product.findFirst({ where: { id, shopId: shop.id } });
  if (!product) return Response.json({ error: "Not found" }, { status: 404 });

  const [live, collections, fixes, diagnosis] = await Promise.all([
    readLiveProduct(session, product.shopifyGid),
    manualCollections(session),
    db().fix.findMany({
      where: { productId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, status: true, createdAt: true, appliedAt: true, undoneAt: true, error: true },
    }),
    db().diagnosis.findFirst({ where: { productId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!live) return Response.json({ error: "Product no longer exists in Shopify" }, { status: 404 });
  const reasons = (diagnosis?.reasons) ?? [];
  const hints = reasons.flatMap((r) => (FIX_HINTS[r.code] ? [{ code: r.code, ...FIX_HINTS[r.code] }] : []));
  return Response.json({ live, manualCollections: collections, fixes, hints, diagnosisId: diagnosis?.id ?? null, upgrade });
});
