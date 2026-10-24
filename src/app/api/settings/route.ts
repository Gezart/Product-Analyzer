import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { sanitizeThresholds } from "@/lib/scoring";
import { DEFAULT_SETTINGS, validateSettings, type SettingsInput } from "@/lib/settings";

function handleError(error: unknown) {
  if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
  throw error;
}

/** Settings plus titles of excluded products (from synced products; unknown IDs show the ID). */
async function withProductTitles(shopId: string, settings: SettingsInput) {
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

export async function GET(request: Request) {
  try {
    const { shop } = await authenticate(request);
    const row = await db().settings.findUnique({ where: { shopId: shop.id } });
    const settings: SettingsInput = row
      ? {
          thresholds: sanitizeThresholds(row.thresholds),
          marginFloorPct: Number(row.marginFloorPct),
          maxDiscountPct: Number(row.maxDiscountPct),
          excludedCollectionIds: row.excludedCollectionIds,
          excludedProductIds: row.excludedProductIds,
        }
      : DEFAULT_SETTINGS;
    return Response.json(await withProductTitles(shop.id, settings));
  } catch (error) {
    return handleError(error);
  }
}

// Saves the settings and queues a re-score of the catalog (picked up by the job worker within seconds).
export async function PUT(request: Request) {
  try {
    const { shop } = await authenticate(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ errors: [{ field: "body" }] }, { status: 400 });
    }
    const result = validateSettings(body);
    if (!result.ok) return Response.json({ errors: result.errors }, { status: 400 });

    const data = result.value;
    await db().settings.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, ...data }, update: data });

    // A pending re-score (maybe waiting to retry) is pulled forward with fresh attempts; it reads the
    // latest settings when it runs. Otherwise queue a new one.
    const { count } = await db().job.updateMany({
      where: { shopId: shop.id, type: "score-shop", status: "queued" },
      data: { runAt: new Date(), attempts: 0 },
    });
    if (count === 0) await enqueue({ type: "score-shop", shopId: shop.id });

    return Response.json(await withProductTitles(shop.id, data));
  } catch (error) {
    return handleError(error);
  }
}
