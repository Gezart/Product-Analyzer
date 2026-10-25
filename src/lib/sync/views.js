import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/errors";
import { enqueue } from "@/lib/jobs/queue";
import { localDateKey } from "@/lib/jobs/schedule";
import { chunkRange, isAccessDenied, viewQueries, viewRange, viewRows } from "@/lib/shopifyql";
import { runShopifyql } from "@/lib/shopifyql-shopify";
import { setSyncState } from "@/lib/sync/store";

/** The first run reads 90 days of views; nightly runs re-read the last 7 (views can arrive late). */
export const VIEW_DAYS_FIRST = 90;
export const VIEW_DAYS_NIGHTLY = 7;
/** Days per query, so each answer stays small (at most products × 7 rows). */
const CHUNK_DAYS = 7;
/** Row counts at which an answer may have been cut off (common limits), when more rows were possible. */
const CAPS = [1000, 10_000, 100_000];
const BATCH = 20_000;
const message = (e) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** The query can't be run (refused, no access, unusable or cut-off answer): retrying won't help. */
class ViewsUnavailable extends Error {}

/**
 * Daily view, cart and purchase sessions per product from ShopifyQL into product_daily_metrics (sales
 * and stock columns are left untouched), then a re-score. Runs after the first import (90 days) and
 * after each nightly catalog refresh (last 7 days). Missing access or an unusable answer is recorded
 * on the "views" sync step and not retried — the app keeps working on sales alone; network and server
 * errors are retried.
 */
export async function syncViews(job, signal) {
  const shopId = job.shopId;
  const shop = await db().shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.uninstalledAt) throw new PermanentJobError("Shop not installed");
  // Views belong to imported products; the import queues this job once it is done.
  const orders = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "orders" } } });
  if (orders?.status !== "done") return 0;

  const state = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "views" } } });
  const range = viewRange(localDateKey(new Date(), shop.timezone), state?.status === "done" ? VIEW_DAYS_NIGHTLY : VIEW_DAYS_FIRST);
  try {
    const session = await getOfflineSession(shop.domain);
    const products = await db().product.count({ where: { shopId, status: { not: "DELETED" } } });
    const { used, rows } = await readViews(session, range, state?.lastCursor, products, signal);
    await storeViews(shopId, range, rows);
    await setSyncState(shopId, "views", { status: "done", error: null, lastCursor: used, lastSyncedAt: new Date() });
    await enqueue({ type: "score-shop", shopId });
    return rows.length;
  } catch (error) {
    // (A stopped run counts like any other retryable error.)
    const unavailable = error instanceof ViewsUnavailable;
    if (unavailable) await setSyncState(shopId, "views", { status: "error", error: error.message });
    // Statuses are recomputed anyway (from the views already stored) unless a retry is coming.
    if (unavailable || job.attempts >= job.maxAttempts) await enqueue({ type: "score-shop", shopId });
    throw unavailable ? new PermanentJobError(`Views unavailable: ${error.message}`) : error;
  }
}

/**
 * Reads the range week by week. The query that worked last time is tried first; once a week returns
 * views, its query is used for the rest. Every week must come back usable, or nothing is stored.
 */
async function readViews(session, range, preferred, products, signal) {
  const chunks = chunkRange(range, CHUNK_DAYS);
  const order = viewQueries(chunks[0])
    .map((c) => c.id)
    .sort((a, b) => Number(b === preferred) - Number(a === preferred));
  const failures = [];
  let used = null;
  const rows = [];
  for (const chunk of chunks) {
    if (signal?.aborted) throw new Error("Stopped (timeout or shutdown)");
    const candidates = used ? [used] : order;
    const possible = products * (chunkRange(chunk, 1).length);
    let done = false;
    for (const id of candidates) {
      const { query } = viewQueries(chunk).find((c) => c.id === id);
      let r;
      try {
        r = await runShopifyql(session, query);
      } catch (e) {
        if (isAccessDenied(message(e))) throw new ViewsUnavailable(`${id}: ${message(e)}`);
        throw e;
      }
      const parsed = r.ok ? viewRows(r.rows) : [];
      if (!r.ok) failures.push(`${id}: ${r.parseErrors.join("; ")}`);
      else if (parsed.length === 0 && (r.rawCount ?? r.rows.length) > 0) failures.push(`${id}: answer had rows but no product views in them`);
      else if (CAPS.includes(r.rows.length) && r.rows.length < possible) {
        throw new ViewsUnavailable(`${id}: ${r.rows.length} rows for ${chunk.from}–${chunk.to} looks cut off`);
      } else {
        // An empty week (e.g. a new store's oldest week) doesn't prove the query reads views.
        if (parsed.length) used = id;
        rows.push(...parsed);
        done = true;
        break;
      }
    }
    if (!done) throw new ViewsUnavailable(failures.join(" | ").slice(0, 1000) || "No query worked");
  }
  return { used, rows };
}

/**
 * Replaces the view columns of the shop's products over the range read (days not returned become 0),
 * creating metric rows where none exist yet. One transaction, so a failure leaves the old numbers.
 */
async function storeViews(shopId, range, rows) {
  const products = await db().product.findMany({
    where: { shopId, shopifyGid: { in: [...new Set(rows.map((r) => r.productGid))] } },
    select: { id: true, shopifyGid: true },
  });
  const idOf = new Map(products.map((p) => [p.shopifyGid, p.id]));
  const known = rows.filter((r) => idOf.has(r.productGid) && r.date >= range.from && r.date <= range.to);
  await db().$transaction(
    async (tx) => {
      await tx.$executeRaw`
        UPDATE "product_daily_metrics" m SET "view_sessions" = 0, "cart_sessions" = 0, "purchase_sessions" = 0
        FROM "products" p
        WHERE m."product_id" = p."id" AND p."shop_id" = ${shopId} AND m."date" BETWEEN ${range.from}::date AND ${range.to}::date
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
