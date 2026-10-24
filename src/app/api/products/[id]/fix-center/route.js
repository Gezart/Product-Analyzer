import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { manualCollections, readLiveProduct } from "@/lib/fix-shopify";
import { FIX_HINTS } from "@/lib/fixes";

// Everything the fix center edits, read live from Shopify, plus hints from the latest diagnosis and the fix history.
export async function GET(request, ctx) {
  try {
    const { shop, session } = await authenticate(request);
    const { id } = await ctx.params;
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
    return Response.json({ live, manualCollections: collections, fixes, hints, diagnosisId: diagnosis?.id ?? null });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
