import { db } from "@/lib/db";
import type { DailySales, ProductRecord } from "@/lib/sync/transform";

const CHUNK = 1000;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Full catalog sync: bulk upsert of products and variants (1,000 rows per statement). Products no longer
 * in Shopify are marked DELETED, not removed, so their price audit log and fix history are kept;
 * removed variants are deleted (price changes keep the row with variant_id set to null).
 */
export async function upsertProducts(shopId: string, products: ProductRecord[]) {
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
      price: p.price,
      compare_at: p.compareAtPrice,
      status: p.status,
      created_at: p.createdAt?.toISOString() ?? null,
    }));
    await db().$executeRaw`
      INSERT INTO "products" ("id", "shop_id", "shopify_gid", "title", "handle", "product_type", "vendor", "collections",
        "image_count", "description_words", "price", "compare_at_price", "status", "shopify_created_at", "updated_at")
      SELECT gen_random_uuid()::text, ${shopId}, t.gid, t.title, t.handle, t.product_type, t.vendor,
        ARRAY(SELECT jsonb_array_elements_text(t.collections)), t.image_count, t.description_words, t.price, t.compare_at,
        t.status, t.created_at, (now() AT TIME ZONE 'UTC')
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS t(
        gid text, title text, handle text, product_type text, vendor text, collections jsonb, image_count int,
        description_words int, price numeric, compare_at numeric, status text, created_at timestamp)
      ON CONFLICT ("shop_id", "shopify_gid") DO UPDATE SET
        "title" = EXCLUDED."title", "handle" = EXCLUDED."handle", "product_type" = EXCLUDED."product_type",
        "vendor" = EXCLUDED."vendor", "collections" = EXCLUDED."collections", "image_count" = EXCLUDED."image_count",
        "description_words" = EXCLUDED."description_words", "price" = EXCLUDED."price",
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
    })),
  );
  for (const batch of chunks(variants)) {
    await db().$executeRaw`
      INSERT INTO "variants" ("id", "product_id", "shopify_gid", "sku", "options", "price", "cost", "inventory_qty")
      SELECT gen_random_uuid()::text, p."id", t.gid, t.sku, t.options, t.price, t.cost, t.qty
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS t(
        product_gid text, gid text, sku text, options jsonb, price numeric, cost numeric, qty int)
      JOIN "products" p ON p."shop_id" = ${shopId} AND p."shopify_gid" = t.product_gid
      ON CONFLICT ("product_id", "shopify_gid") DO UPDATE SET
        "sku" = EXCLUDED."sku", "options" = EXCLUDED."options", "price" = EXCLUDED."price",
        "cost" = EXCLUDED."cost", "inventory_qty" = EXCLUDED."inventory_qty"
    `;
  }

  const productGids = JSON.stringify(products.map((p) => p.gid));
  const variantGids = JSON.stringify(variants.map((v) => v.gid));
  await db().$executeRaw`
    UPDATE "products" SET "status" = 'DELETED', "updated_at" = (now() AT TIME ZONE 'UTC')
    WHERE "shop_id" = ${shopId} AND "status" <> 'DELETED'
      AND "shopify_gid" NOT IN (SELECT jsonb_array_elements_text(${productGids}::jsonb))
  `;
  await db().$executeRaw`
    DELETE FROM "variants" v USING "products" p
    WHERE v."product_id" = p."id" AND p."shop_id" = ${shopId}
      AND v."shopify_gid" NOT IN (SELECT jsonb_array_elements_text(${variantGids}::jsonb))
  `;
}

/**
 * Replaces units and revenue for every day from `fromDate` (YYYY-MM-DD) on, in one transaction: days
 * without sales are reset to 0 first, then the synced totals are written. View columns are left untouched.
 */
export async function replaceDailySales(shopId: string, fromDate: string, sales: DailySales[]) {
  await db().$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "product_daily_metrics" m SET "units" = 0, "revenue" = 0
      FROM "products" p
      WHERE m."product_id" = p."id" AND p."shop_id" = ${shopId} AND m."date" >= ${fromDate}::date
    `;
    for (const batch of chunks(sales, 5000)) {
      const rows = batch.map((s) => ({ product_gid: s.productGid, date: s.date, units: s.units, revenue: s.revenue }));
      await tx.$executeRaw`
        INSERT INTO "product_daily_metrics" ("product_id", "date", "units", "revenue")
        SELECT p."id", t.date::date, t.units, t.revenue
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS t(product_gid text, date text, units int, revenue numeric)
        JOIN "products" p ON p."shop_id" = ${shopId} AND p."shopify_gid" = t.product_gid
        ON CONFLICT ("product_id", "date") DO UPDATE SET "units" = EXCLUDED."units", "revenue" = EXCLUDED."revenue"
      `;
    }
  }, { timeout: 60_000 });
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
  await db().syncState.deleteMany({ where: { shopId, resource: { in: ["products", "orders"] } } });
  await db().syncState.createMany({
    data: ["products", "orders"].map((resource) => ({ shopId, resource, status: "pending" })),
    skipDuplicates: true,
  });
}
