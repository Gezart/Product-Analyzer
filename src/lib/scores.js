import { db } from "@/lib/db";

const num = (v) => (v == null ? null : Number(v));

/**
 * Each product's latest score with its title (deleted products left out). A backward index scan per
 * product, independent of other shops' rows. With `unscored`, products not scored yet (new since the
 * last run) are included with status "unscored".
 */
export async function latestScores(shopId, { unscored = false } = {}) {
  const rows = unscored
    ? await db().$queryRaw`
    SELECT p."id" AS "productId", p."title", COALESCE(s."status", 'unscored') AS "status",
      COALESCE(s."money_at_stake", 0)::text AS "moneyAtStake", COALESCE(s."stock_value", 0)::text AS "stockValue",
      COALESCE(s."cost_is_estimate", false) AS "costIsEstimate", s."sell_through"::text AS "sellThrough",
      s."days_of_cover"::text AS "daysOfCover", s."computed_at" AS "computedAt"
    FROM "products" p
    LEFT JOIN LATERAL (
      SELECT x.* FROM "product_scores" x WHERE x."product_id" = p."id" ORDER BY x."computed_at" DESC LIMIT 1
    ) s ON true
    WHERE p."shop_id" = ${shopId} AND p."status" <> 'DELETED'
  `
    : await db().$queryRaw`
    SELECT p."id" AS "productId", p."title", s."status",
      s."money_at_stake"::text AS "moneyAtStake", s."stock_value"::text AS "stockValue",
      s."cost_is_estimate" AS "costIsEstimate", s."sell_through"::text AS "sellThrough",
      s."days_of_cover"::text AS "daysOfCover", s."computed_at" AS "computedAt"
    FROM "products" p
    CROSS JOIN LATERAL (
      SELECT x.* FROM "product_scores" x WHERE x."product_id" = p."id" ORDER BY x."computed_at" DESC LIMIT 1
    ) s
    WHERE p."shop_id" = ${shopId} AND p."status" <> 'DELETED'
  `;
  return rows.map((r) => ({
    productId: r.productId,
    title: r.title,
    status: r.status,
    moneyAtStake: Number(r.moneyAtStake),
    stockValue: Number(r.stockValue),
    costIsEstimate: r.costIsEstimate,
    sellThrough: num(r.sellThrough),
    daysOfCover: num(r.daysOfCover),
    computedAt: r.computedAt,
  }));
}
