// Page builder suggestions: for the store's products, the blocks that would help each one (with why),
// from its status, its latest diagnosis, its variants' stock and "often bought together".

import { db } from "@/lib/db";
import { suggestBlocks } from "@/lib/page-builder";

/** Products the page lists (most money at stake first, then the rest). */
const SHOWN = 12;
/** Products looked at: the ones with the most money at stake, then the others (bestsellers have none). */
const CANDIDATES = 3000;

/**
 * Up to SHOWN products with their suggested blocks: `{ id, gid, title, status, suggestions: [{ type, reason }] }`,
 * products that need sales first (most money at stake), then the rest. Products the plan doesn't analyze are left out.
 */
export async function productSuggestions(shopId, pageBuilder) {
  const products = await db().$queryRaw`
    SELECT p."id", p."shopify_gid" AS "gid", p."title", p."collections", p."bought_together" AS "boughtTogether", s."status"
    FROM "products" p
    CROSS JOIN LATERAL (SELECT x."status", x."money_at_stake" FROM "product_scores" x WHERE x."product_id" = p."id" ORDER BY x."computed_at" DESC LIMIT 1) s
    WHERE p."shop_id" = ${shopId} AND p."status" = 'ACTIVE' AND s."status" NOT IN ('over_limit', 'excluded')
    ORDER BY s."money_at_stake" DESC, p."id"
    LIMIT ${CANDIDATES}`;
  if (!products.length) return [];
  const ids = products.map((p) => p.id);
  const [variants, diagnoses] = await Promise.all([
    db().variant.findMany({ where: { productId: { in: ids } }, select: { productId: true, options: true, inventoryQty: true, sellsWhenOut: true } }),
    db().$queryRaw`
      SELECT DISTINCT ON ("product_id") "product_id" AS "productId", "reasons"
      FROM "diagnoses" WHERE "product_id" = ANY(${ids})
      ORDER BY "product_id", "created_at" DESC`,
  ]);
  const variantsOf = new Map();
  for (const v of variants) variantsOf.set(v.productId, [...(variantsOf.get(v.productId) ?? []), v]);
  const reasonsOf = new Map(diagnoses.map((d) => [d.productId, (Array.isArray(d.reasons) ? d.reasons : []).map((r) => r?.code).filter(Boolean)]));

  const out = [];
  for (const p of products) {
    const own = variantsOf.get(p.id) ?? [];
    const options = [...new Set(own.flatMap((v) => Object.keys(v.options && typeof v.options === "object" ? v.options : {})))];
    const suggestions = suggestBlocks(
      { gid: p.gid, collections: p.collections, status: p.status, reasons: reasonsOf.get(p.id) ?? [], options, variants: own, boughtTogether: p.boughtTogether },
      pageBuilder,
    );
    if (suggestions.length) out.push({ id: p.id, gid: p.gid, title: p.title, status: p.status, suggestions });
    if (out.length >= SHOWN) break;
  }
  return out;
}
