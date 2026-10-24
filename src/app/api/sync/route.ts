import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";

// Initial import progress for the home page.
export async function GET(request: Request) {
  try {
    const { shop } = await authenticate(request);
    const [states, products] = await Promise.all([
      db().syncState.findMany({ where: { shopId: shop.id }, select: { resource: true, status: true, error: true, lastSyncedAt: true } }),
      db().product.count({ where: { shopId: shop.id } }),
    ]);
    return Response.json({ states, products });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
