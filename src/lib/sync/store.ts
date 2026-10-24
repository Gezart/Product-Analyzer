import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { OrderLineRecord, ProductRecord } from "@/lib/sync/transform";

type Tx = Prisma.TransactionClient;

const CHUNK = 1000;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Bulk upsert of products and variants (1,000 rows per statement). Variants removed from a synced
 * product are deleted (price changes keep the row with variant_id set to null), unless the variant
 * list was cut off (`partialVariants`).
 *
 * A full catalog sync passes `snapshotAt` (when its bulk query started): products changed since then
 * by live sync are left alone, and products no longer in Shopify are marked DELETED, not removed, so
 * their price audit log and fix history are kept.
 */
export async function upsertProducts(
  shopId: string,
  input: ProductRecord[],
  options: { snapshotAt: Date } | { partialVariants?: string[] } = {},
) {
  const snapshotAt = "snapshotAt" in options ? options.snapshotAt : null;
  const fresh = snapshotAt
    ? new Set(
        (await db().product.findMany({ where: { shopId, updatedAt: { gte: snapshotAt } }, select: { shopifyGid: true } })).map(
          (p) => p.shopifyGid,
        ),
      )
    : new Set<string>();
  const products = input.filter((p) => !fresh.has(p.gid));
  const partial = new Set("partialVariants" in options ? options.partialVariants ?? [] : []);

  for (const batch of chunks(products)) {
    const rows = batch.map((p) => ({
      gid: p.gid,
      title: p.title,
      handle: p.handle,
      product_type: p.productType,
      vendor: p.vendor,
      collections: p.collections,
      image_count: p.imageCount,
      description_words: p.descriptionWords,
      description: p.description,
      seo_title: p.seoTitle,
      seo_description: p.seoDescription,
      price: p.price,
      compare_at: p.compareAtPrice,
      status: p.status,
      created_at: p.createdAt?.toISOString() ?? null,
    }));
    await db().$executeRaw`
      INSERT INTO "products" ("id", "shop_id", "shopify_gid", "title", "handle", "product_type", "vendor", "collections",
        "image_count", "description_words", "description", "seo_title", "seo_description",
        "price", "compare_at_price", "status", "shopify_created_at", "updated_at")
      SELECT gen_random_uuid()::text, ${shopId}, t.gid, t.title, t.handle, t.product_type, t.vendor,
        ARRAY(SELECT jsonb_array_elements_text(t.collections)), t.image_count, t.description_words,
        t.description, t.seo_title, t.seo_description, t.price, t.compare_at,
        t.status, t.created_at, (now() AT TIME ZONE 'UTC')
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS t(
        gid text, title text, handle text, product_type text, vendor text, collections jsonb, image_count int,
        description_words int, description text, seo_title text, seo_description text,
        price numeric, compare_at numeric, status text, created_at timestamp)
      ON CONFLICT ("shop_id", "shopify_gid") DO UPDATE SET
        "title" = EXCLUDED."title", "handle" = EXCLUDED."handle", "product_type" = EXCLUDED."product_type",
        "vendor" = EXCLUDED."vendor", "collections" = EXCLUDED."collections", "image_count" = EXCLUDED."image_count",
        "description_words" = EXCLUDED."description_words", "description" = EXCLUDED."description",
        "seo_title" = EXCLUDED."seo_title", "seo_description" = EXCLUDED."seo_description", "price" = EXCLUDED."price",
        "compare_at_price" = EXCLUDED."compare_at_price", "status" = EXCLUDED."status",
        "shopify_created_at" = EXCLUDED."shopify_created_at", "updated_at" = EXCLUDED."updated_at"
    `;
  }

  const variants = products.flatMap((p) =>
    p.variants.map((v) => ({
      product_gid: p.gid,
      gid: v.gid,
      sku: v.sku,
      options: v.options,
      price: v.price,
      cost: v.cost,
      qty: v.inventoryQty,
      oversell: v.sellsWhenOut,
    })),
  );
  for (const batch of chunks(variants)) {
    await db().$executeRaw`
      INSERT INTO "variants" ("id", "product_id", "shopify_gid", "sku", "options", "price", "cost", "inventory_qty", "sells_when_out")
      SELECT gen_random_uuid()::text, p."id", t.gid, t.sku, t.options, t.price, t.cost, t.qty, COALESCE(t.oversell, false)
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS t(
        product_gid text, gid text, sku text, options jsonb, price numeric, cost numeric, qty int, oversell boolean)
      JOIN "products" p ON p."shop_id" = ${shopId} AND p."shopify_gid" = t.product_gid
      ON CONFLICT ("product_id", "shopify_gid") DO UPDATE SET
        "sku" = EXCLUDED."sku", "options" = EXCLUDED."options", "price" = EXCLUDED."price",
        "cost" = EXCLUDED."cost", "inventory_qty" = EXCLUDED."inventory_qty", "sells_when_out" = EXCLUDED."sells_when_out"
    `;
  }

  if (snapshotAt) {
    const seen = JSON.stringify(input.map((p) => p.gid));
    await db().$executeRaw`
      UPDATE "products" SET "status" = 'DELETED', "updated_at" = (now() AT TIME ZONE 'UTC')
      WHERE "shop_id" = ${shopId} AND "status" <> 'DELETED' AND "updated_at" < ${snapshotAt}
        AND "shopify_gid" NOT IN (SELECT jsonb_array_elements_text(${seen}::jsonb))
    `;
  }
  const complete = JSON.stringify(products.filter((p) => !partial.has(p.gid)).map((p) => p.gid));
  const variantGids = JSON.stringify(variants.map((v) => v.gid));
  await db().$executeRaw`
    DELETE FROM "variants" v USING "products" p
    WHERE v."product_id" = p."id" AND p."shop_id" = ${shopId}
      AND p."shopify_gid" IN (SELECT jsonb_array_elements_text(${complete}::jsonb))
      AND v."shopify_gid" NOT IN (SELECT jsonb_array_elements_text(${variantGids}::jsonb))
  `;
}

export async function markProductDeleted(shopId: string, productGid: string) {
  await db().product.updateMany({ where: { shopId, shopifyGid: productGid }, data: { status: "DELETED" } });
}

type SalesScope = { fromDate: string } | { productGids: string[] } | { pairs: { productGid: string; date: string }[] };

/** SQL condition limiting (product gid, date) columns to a scope. */
function scopeSql(scope: SalesScope, gidCol: string, dateCol: string) {
  const gid = Prisma.raw(gidCol);
  const date = Prisma.raw(dateCol);
  if ("fromDate" in scope) return Prisma.sql`${date} >= ${scope.fromDate}::date`;
  if ("productGids" in scope) {
    return Prisma.sql`${gid} IN (SELECT jsonb_array_elements_text(${JSON.stringify(scope.productGids)}::jsonb))`;
  }
  const pairs = JSON.stringify(scope.pairs.map((p) => ({ g: p.productGid, d: p.date })));
  return Prisma.sql`(${gid}, ${date}) IN (SELECT t.g, t.d::date FROM jsonb_to_recordset(${pairs}::jsonb) AS t(g text, d text))`;
}

/**
 * Serialises every writer of a shop's order lines and daily sales (different orders can touch the
 * same product-day row, and a rebuild must see all committed lines). Held until the transaction ends.
 */
async function lockShopSales(tx: Tx, shopId: string, waitSeconds?: number) {
  // Bounded wait (webhooks must answer within 5 s and each waiter holds a connection); a timeout
  // fails the request or job, and Shopify / the job queue retries it.
  if (waitSeconds) await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${Math.floor(waitSeconds)}s'`);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sales:${shopId}`}))`;
}

/**
 * Rebuilds units and revenue in product_daily_metrics from order_lines for a scope: rows in scope are
 * reset to 0, then the sums are written. View columns are left untouched.
 */
async function rebuildDailySales(tx: Tx, shopId: string, scope: SalesScope) {
  await tx.$executeRaw`
    UPDATE "product_daily_metrics" m SET "units" = 0, "revenue" = 0
    FROM "products" p
    WHERE m."product_id" = p."id" AND p."shop_id" = ${shopId} AND ${scopeSql(scope, 'p."shopify_gid"', 'm."date"')}
  `;
  await tx.$executeRaw`
    INSERT INTO "product_daily_metrics" ("product_id", "date", "units", "revenue")
    SELECT p."id", l."date", SUM(l."quantity"), SUM(l."revenue")
    FROM "order_lines" l
    JOIN "products" p ON p."shop_id" = l."shop_id" AND p."shopify_gid" = l."product_gid"
    WHERE l."shop_id" = ${shopId} AND ${scopeSql(scope, 'l."product_gid"', 'l."date"')}
    GROUP BY p."id", l."date"
    ON CONFLICT ("product_id", "date") DO UPDATE SET "units" = EXCLUDED."units", "revenue" = EXCLUDED."revenue"
  `;
}

async function insertLines(tx: Tx, shopId: string, lines: OrderLineRecord[]) {
  for (const batch of chunks(lines, 5000)) {
    const rows = batch.map((l) => ({
      line: l.lineGid,
      ord: l.orderGid,
      product: l.productGid,
      variant: l.variantGid,
      date: l.date,
      qty: l.quantity,
      revenue: l.revenue,
      updated: l.orderUpdatedAt.toISOString(),
    }));
    await tx.$executeRaw`
      INSERT INTO "order_lines" ("shop_id", "line_gid", "order_gid", "product_gid", "variant_gid", "date", "quantity", "revenue", "order_updated_at")
      SELECT ${shopId}, t.line, t.ord, t.product, t.variant, t.date::date, t.qty, t.revenue, t.updated
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS t(
        line text, ord text, product text, variant text, date text, qty int, revenue numeric, updated timestamp)
      ON CONFLICT ("shop_id", "line_gid") DO UPDATE SET
        "order_gid" = EXCLUDED."order_gid", "product_gid" = EXCLUDED."product_gid", "variant_gid" = EXCLUDED."variant_gid",
        "date" = EXCLUDED."date", "quantity" = EXCLUDED."quantity", "revenue" = EXCLUDED."revenue",
        "order_updated_at" = EXCLUDED."order_updated_at"
      WHERE "order_lines"."order_updated_at" <= EXCLUDED."order_updated_at"
    `;
  }
}

/**
 * Import: replaces order lines from `fromDate` (local date) on with a bulk snapshot taken at
 * `snapshotAt`, then rebuilds daily sales. Lines written by webhooks after the snapshot started are
 * kept, and a stored line is never replaced by an older version.
 */
export async function replaceOrderLines(shopId: string, fromDate: string, lines: OrderLineRecord[], snapshotAt: Date) {
  await db().$transaction(
    async (tx) => {
      await lockShopSales(tx, shopId);
      await tx.$executeRaw`
        DELETE FROM "order_lines"
        WHERE "shop_id" = ${shopId} AND "date" >= ${fromDate}::date AND "order_updated_at" < ${snapshotAt}
      `;
      await insertLines(tx, shopId, lines);
      await rebuildDailySales(tx, shopId, { fromDate });
    },
    { timeout: 120_000 },
  );
}

/**
 * Live update for one order (webhook). Ignored when an equal-or-newer version is already stored
 * (webhooks can repeat or arrive out of order). Rebuilds the days the order touched before and after.
 * Returns false when skipped as stale.
 */
export async function applyOrderLines(shopId: string, orderGid: string, updatedAt: Date, lines: OrderLineRecord[]) {
  return db().$transaction(async (tx) => {
    await lockShopSales(tx, shopId, 3);
    const existing = await tx.orderLine.findMany({
      where: { shopId, orderGid },
      select: { lineGid: true, productGid: true, date: true, orderUpdatedAt: true },
    });
    if (existing.some((l) => l.orderUpdatedAt.getTime() > updatedAt.getTime())) return false;

    const keep = new Set(lines.map((l) => l.lineGid));
    const gone = existing.filter((l) => !keep.has(l.lineGid)).map((l) => l.lineGid);
    if (gone.length) await tx.orderLine.deleteMany({ where: { shopId, lineGid: { in: gone } } });
    await insertLines(tx, shopId, lines);

    const pairs = new Map<string, { productGid: string; date: string }>();
    for (const l of existing) pairs.set(`${l.productGid}|${l.date.toISOString().slice(0, 10)}`, { productGid: l.productGid, date: l.date.toISOString().slice(0, 10) });
    for (const l of lines) pairs.set(`${l.productGid}|${l.date}`, { productGid: l.productGid, date: l.date });
    if (pairs.size) await rebuildDailySales(tx, shopId, { pairs: [...pairs.values()] });
    return true;
  });
}

/** After a product is (re)synced, its sales history is rebuilt from stored order lines. */
export async function rebuildProductSales(shopId: string, productGids: string[]) {
  await db().$transaction(
    async (tx) => {
      await lockShopSales(tx, shopId, 60);
      await rebuildDailySales(tx, shopId, { productGids });
    },
    { timeout: 90_000 },
  );
}

export async function setSyncState(
  shopId: string,
  resource: string,
  data: { status: string; error?: string | null; lastCursor?: string | null; lastSyncedAt?: Date },
) {
  await db().syncState.upsert({
    where: { shopId_resource: { shopId, resource } },
    create: { shopId, resource, ...data },
    update: data,
  });
}

/** Fresh "pending" steps for a new install (old ones may remain after a reinstall within 48 h). */
export async function resetSyncSteps(shopId: string) {
  await db().syncState.deleteMany({ where: { shopId, resource: { in: ["products", "orders", "webhooks", "catchup", "refresh"] } } });
  await db().syncState.createMany({
    data: ["products", "orders"].map((resource) => ({ shopId, resource, status: "pending" })),
    skipDuplicates: true,
  });
}

/**
 * End-of-day stock per product for a local date (negative variant stock counts as 0). Products deleted
 * in Shopify are skipped. Sales and view columns are left untouched.
 */
export async function snapshotInventory(shopId: string, date: string) {
  await db().$executeRaw`
    INSERT INTO "product_daily_metrics" ("product_id", "date", "inventory_qty")
    SELECT p."id", ${date}::date, COALESCE(SUM(GREATEST(v."inventory_qty", 0)), 0)
    FROM "products" p LEFT JOIN "variants" v ON v."product_id" = p."id"
    WHERE p."shop_id" = ${shopId} AND p."status" <> 'DELETED'
    GROUP BY p."id"
    ON CONFLICT ("product_id", "date") DO UPDATE SET "inventory_qty" = EXCLUDED."inventory_qty"
  `;
}

/** Keeps score history for `days` days (the newest score per product is always kept). */
export async function pruneScores(shopId: string, days = 90) {
  await db().$executeRaw`
    DELETE FROM "product_scores" s USING "products" p
    WHERE s."product_id" = p."id" AND p."shop_id" = ${shopId}
      AND s."computed_at" < (now() AT TIME ZONE 'UTC') - make_interval(days => ${days})
      AND s."computed_at" < (SELECT MAX(x."computed_at") FROM "product_scores" x WHERE x."product_id" = s."product_id")
  `;
}
