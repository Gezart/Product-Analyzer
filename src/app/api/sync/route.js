import { db } from "@/lib/db";
import { appRoute } from "@/lib/route";
import { retryInitialSync } from "@/lib/sync/initial-sync";

// Initial import progress for the home page.
export const GET = appRoute(async ({ shop }) => {
  const [states, products] = await Promise.all([
    db().syncState.findMany({ where: { shopId: shop.id }, select: { resource: true, status: true, error: true, lastSyncedAt: true } }),
    db().product.count({ where: { shopId: shop.id, status: { not: "DELETED" } } }),
  ]);
  return Response.json({ states, products });
});

// Retry the import after a failed step.
export const POST = appRoute(async ({ shop }) => {
  const started = await retryInitialSync(shop.id);
  return started ? Response.json({ started }) : Response.json({ error: "Sync still running" }, { status: 409 });
});
