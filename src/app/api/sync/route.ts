import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { retryInitialSync } from "@/lib/sync/initial-sync";

function handleError(error: unknown) {
  if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
  throw error;
}

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
    return handleError(error);
  }
}

// Retry the import after a failed step.
export async function POST(request: Request) {
  try {
    const { shop } = await authenticate(request);
    const started = await retryInitialSync(shop.id);
    return started ? Response.json({ started }) : new Response("Sync still running", { status: 409 });
  } catch (error) {
    return handleError(error);
  }
}
