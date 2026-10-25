import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { appRoute } from "@/lib/route";
import { sanitizeThresholds } from "@/lib/scoring";
import { DEFAULT_SETTINGS, validateSettings } from "@/lib/settings";

/** Settings plus titles of excluded products (from synced products; unknown IDs show the ID). */
async function withProductTitles(shopId, settings) {
  const rows = settings.excludedProductIds.length
    ? await db().product.findMany({
        where: { shopId, shopifyGid: { in: settings.excludedProductIds } },
        select: { shopifyGid: true, title: true },
      })
    : [];
  const titles = new Map(rows.map((r) => [r.shopifyGid, r.title]));
  return {
    ...settings,
    excludedProducts: settings.excludedProductIds.map((id) => ({ id, title: titles.get(id) ?? id })),
  };
}

export const GET = appRoute(async ({ shop }) => {
  const row = await db().settings.findUnique({ where: { shopId: shop.id } });
  const settings = row
    ? {
        thresholds: sanitizeThresholds(row.thresholds),
        marginFloorPct: Number(row.marginFloorPct),
        maxDiscountPct: Number(row.maxDiscountPct),
        excludedCollectionIds: row.excludedCollectionIds,
        excludedProductIds: row.excludedProductIds,
        markdownEndAction: row.markdownEndAction === "hold" ? "hold" : "restore",
      }
    : DEFAULT_SETTINGS;
  return Response.json(await withProductTitles(shop.id, settings));
});

// Saves the settings and queues a re-score of the catalog (picked up by the job worker within seconds).
export const PUT = appRoute(async ({ request, shop }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: [{ field: "body" }] }, { status: 400 });
  }
  const result = validateSettings(body);
  if (!result.ok) return Response.json({ errors: result.errors }, { status: 400 });

  const data = result.value;
  await db().settings.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, ...data }, update: data });

  // A pending re-score reads the latest settings when it runs: pull it forward with fresh attempts,
  // unless it timed out (the old run may still be going; it retries once its lock would have expired).
  // Otherwise queue a new one.
  const pending = await db().job.findFirst({
    where: { shopId: shop.id, type: "score-shop", status: "queued" },
    select: { id: true, lastError: true },
  });
  if (!pending) await enqueue({ type: "score-shop", shopId: shop.id });
  else if (!pending.lastError?.startsWith("JobTimeoutError")) {
    await db().job.updateMany({ where: { id: pending.id, status: "queued" }, data: { runAt: new Date(), attempts: 0 } });
  }

  return Response.json(await withProductTitles(shop.id, data));
});
