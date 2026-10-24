import { authenticate, AuthError } from "@/lib/auth";
import { summarize } from "@/lib/dashboard";
import { db } from "@/lib/db";

const num = (v) => (v == null ? null : Number(v));

// Catalog health from each product's latest score.
export async function GET(request) {
  try {
    const { shop } = await authenticate(request);
    // Latest score per product via a backward index scan per product (independent of other shops' rows).
    const rows = await db().$queryRaw`
      SELECT p."id" AS "productId", p."title", s."status",
        s."money_at_stake"::text AS "moneyAtStake", s."stock_value"::text AS "stockValue",
        s."cost_is_estimate" AS "costIsEstimate", s."sell_through"::text AS "sellThrough",
        s."days_of_cover"::text AS "daysOfCover", s."computed_at" AS "computedAt"
      FROM "products" p
      CROSS JOIN LATERAL (
        SELECT x.* FROM "product_scores" x WHERE x."product_id" = p."id" ORDER BY x."computed_at" DESC LIMIT 1
      ) s
      WHERE p."shop_id" = ${shop.id} AND p."status" <> 'DELETED'
    `;
    const scores = rows.map((r) => ({
      productId: r.productId,
      title: r.title,
      status: r.status,
      moneyAtStake: Number(r.moneyAtStake),
      stockValue: Number(r.stockValue),
      costIsEstimate: r.costIsEstimate,
      sellThrough: num(r.sellThrough),
      daysOfCover: num(r.daysOfCover),
    }));
    const scoredAt = rows.reduce((max, r) => (!max || r.computedAt > max ? r.computedAt : max), null);
    return Response.json({ currency: shop.currency, scoredAt, ...summarize(scores) });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
