import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { productGate } from "@/lib/feature-gate";
import { FEATURE_PLAN, hasFeature } from "@/lib/plans";
import { manualCollections, readLiveProduct } from "@/lib/fix-shopify";
import { FIX_HINTS } from "@/lib/fixes";

// Everything the fix center edits, read live from Shopify, plus hints from the latest diagnosis and the fix history.
export async function GET(request, ctx) {
  try {
    const { shop, session } = await authenticate(request);
    const { id } = await ctx.params;
    // History and undo stay available on every plan; applying needs the plan (and the product within its limit).
    const overLimit = await productGate(shop, id);
    const upgrade = !hasFeature(shop.plan, "fixCenter")
      ? { plan: FEATURE_PLAN.fixCenter, reason: "Applying fixes is included from the Starter plan." }
      : overLimit
        ? { plan: (await overLimit.json()).upgrade, reason: "This product is beyond the number of products your plan analyzes." }
        : null;
    const product = await db().product.findFirst({ where: { id, shopId: shop.id } });
    if (!product) return new Response("Not found", { status: 404 });

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
    if (!live) return new Response("Product no longer exists in Shopify", { status: 404 });
    const reasons = (diagnosis?.reasons) ?? [];
    const hints = reasons.flatMap((r) => (FIX_HINTS[r.code] ? [{ code: r.code, ...FIX_HINTS[r.code] }] : []));
    return Response.json({ live, manualCollections: collections, fixes, hints, diagnosisId: diagnosis?.id ?? null, upgrade });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
