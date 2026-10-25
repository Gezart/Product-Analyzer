import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/errors";
import { enqueue } from "@/lib/jobs/queue";
import { localDateKey } from "@/lib/jobs/schedule";
import { viewQueries, viewRows } from "@/lib/shopifyql";
import { runShopifyql } from "@/lib/shopifyql-shopify";
import { setSyncState } from "@/lib/sync/store";

/** The first run reads 90 days of views; nightly runs re-read the last 7 (views can arrive late). */
export const VIEW_DAYS_FIRST = 90;
export const VIEW_DAYS_NIGHTLY = 7;
const BATCH = 20_000;
const DAY_MS = 86_400_000;
const message = (e) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const isDenied = (text) => /access denied|ACCESS_DENIED|read_reports|protected customer data/i.test(text);

/**
 * Daily view, cart and purchase sessions per product from ShopifyQL into product_daily_metrics (sales
 * and stock columns are left untouched). Tries the query that worked last time first. Missing access
 * (scope or protected customer data) is recorded on the "views" sync step and not retried; the app
 * keeps working on sales alone.
 */
export async function syncViews(shopId) {
  const shop = await db().shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.uninstalledAt) throw new PermanentJobError("Shop not installed");
  const state = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "views" } } });
  const days = state?.status === "done" ? VIEW_DAYS_NIGHTLY : VIEW_DAYS_FIRST;
  const session = await getOfflineSession(shop.domain);

  const candidates = viewQueries(days).sort((a, b) => Number(b.id === state?.lastCursor) - Number(a.id === state?.lastCursor));
  const failures = [];
  let used = null;
  let rows = [];
  let retryable = null;
  for (const c of candidates) {
    try {
      const r = await runShopifyql(session, c.query);
      if (!r.ok) {
        failures.push(`${c.id}: ${r.parseErrors.join("; ")}`);
        continue;
      }
      used = c.id;
      rows = viewRows(r.rows);
      break;
    } catch (e) {
      failures.push(`${c.id}: ${message(e)}`);
      if (isDenied(message(e))) break;
      retryable = e;
    }
  }
  if (!used) {
    const error = failures.join(" | ").slice(0, 1000);
    await setSyncState(shopId, "views", { status: "error", error });
    // A network or server error is worth retrying; a refused query or missing access isn't.
    if (retryable && !isDenied(error)) throw retryable;
    throw new PermanentJobError(`Views unavailable: ${error}`);
  }

  await storeViews(shopId, shop.timezone, days, rows);
  await setSyncState(shopId, "views", { status: "done", error: null, lastCursor: used, lastSyncedAt: new Date() });
  // Views change conversion-based statuses (page problem, hidden gem).
  if (rows.length) await enqueue({ type: "score-shop", shopId });
  return rows.length;
}

/**
 * Replaces the view columns for the shop's products over the read range (days not returned become 0),
 * creating metric rows where none exist yet. One transaction, so a failure leaves the old numbers.
 */
async function storeViews(shopId, timeZone, days, rows) {
  const today = localDateKey(new Date(), timeZone);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY_MS);
  const products = await db().product.findMany({
    where: { shopId, shopifyGid: { in: [...new Set(rows.map((r) => r.productGid))] } },
    select: { id: true, shopifyGid: true },
  });
  const idOf = new Map(products.map((p) => [p.shopifyGid, p.id]));
  const known = rows.filter((r) => idOf.has(r.productGid) && r.date >= from.toISOString().slice(0, 10) && r.date < today);
  await db().$transaction(
    async (tx) => {
      await tx.$executeRaw`
        UPDATE "product_daily_metrics" m SET "view_sessions" = 0, "cart_sessions" = 0, "purchase_sessions" = 0
        FROM "products" p
        WHERE m."product_id" = p."id" AND p."shop_id" = ${shopId} AND m."date" >= ${from}::date AND m."date" < ${today}::date
          AND (m."view_sessions" <> 0 OR m."cart_sessions" <> 0 OR m."purchase_sessions" <> 0)`;
      for (let i = 0; i < known.length; i += BATCH) {
        const part = known.slice(i, i + BATCH);
        await tx.$executeRaw`
          INSERT INTO "product_daily_metrics" ("product_id", "date", "view_sessions", "cart_sessions", "purchase_sessions")
          SELECT * FROM unnest(
            ${part.map((r) => idOf.get(r.productGid))}::text[], ${part.map((r) => r.date)}::date[],
            ${part.map((r) => r.views)}::int[], ${part.map((r) => r.carts)}::int[], ${part.map((r) => r.purchases)}::int[]
          )
          ON CONFLICT ("product_id", "date") DO UPDATE SET
            "view_sessions" = EXCLUDED."view_sessions", "cart_sessions" = EXCLUDED."cart_sessions", "purchase_sessions" = EXCLUDED."purchase_sessions"`;
      }
    },
    { timeout: 120_000 },
  );
}
