import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { sanitizeThresholds } from "@/lib/scoring";
import { DEFAULT_SETTINGS, validateSettings } from "@/lib/settings";

function handleError(error: unknown) {
  if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
  throw error;
}

export async function GET(request: Request) {
  try {
    const { shop } = await authenticate(request);
    const row = await db().settings.findUnique({ where: { shopId: shop.id } });
    if (!row) return Response.json(DEFAULT_SETTINGS);
    return Response.json({
      thresholds: sanitizeThresholds(row.thresholds),
      marginFloorPct: Number(row.marginFloorPct),
      maxDiscountPct: Number(row.maxDiscountPct),
      excludedCollectionIds: row.excludedCollectionIds,
    });
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
      return Response.json({ errors: ["Invalid JSON"] }, { status: 400 });
    }
    const result = validateSettings(body);
    if (!result.ok) return Response.json({ errors: result.errors }, { status: 400 });

    const data = result.value;
    await db().settings.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, ...data }, update: data });

    // One pending re-score is enough; it reads the latest settings when it runs.
    const pending = await db().job.findFirst({ where: { shopId: shop.id, type: "score-shop", status: "queued" } });
    if (!pending) await enqueue({ type: "score-shop", shopId: shop.id });

    return Response.json(result.value);
  } catch (error) {
    return handleError(error);
  }
}
