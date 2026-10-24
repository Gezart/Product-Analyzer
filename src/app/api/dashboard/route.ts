import { authenticate, AuthError } from "@/lib/auth";
import { summarize, type ScoreRow } from "@/lib/dashboard";
import { db } from "@/lib/db";

type Row = {
  productId: string;
  title: string;
  status: string;
  moneyAtStake: string;
  stockValue: string;
  costIsEstimate: boolean;
  sellThrough: string | null;
  daysOfCover: string | null;
  computedAt: Date;
};

const num = (v: string | null) => (v == null ? null : Number(v));

// Catalog health from each product's latest score.
export async function GET(request: Request) {
  try {
    const { shop } = await authenticate(request);
    const rows = await db().$queryRaw<Row[]>`
      SELECT DISTINCT ON (s."product_id")
        s."product_id" AS "productId", p."title", s."status",
        s."money_at_stake"::text AS "moneyAtStake", s."stock_value"::text AS "stockValue",
        s."cost_is_estimate" AS "costIsEstimate", s."sell_through"::text AS "sellThrough",
        s."days_of_cover"::text AS "daysOfCover", s."computed_at" AS "computedAt"
      FROM "product_scores" s JOIN "products" p ON p."id" = s."product_id"
      WHERE p."shop_id" = ${shop.id} AND p."status" <> 'DELETED'
      ORDER BY s."product_id", s."computed_at" DESC
    `;
    const scores: ScoreRow[] = rows.map((r) => ({
      productId: r.productId,
      title: r.title,
      status: r.status,
      moneyAtStake: Number(r.moneyAtStake),
      stockValue: Number(r.stockValue),
      costIsEstimate: r.costIsEstimate,
      sellThrough: num(r.sellThrough),
      daysOfCover: num(r.daysOfCover),
    }));
    const scoredAt = rows.reduce<Date | null>((max, r) => (!max || r.computedAt > max ? r.computedAt : max), null);
    return Response.json({ currency: shop.currency ?? "USD", scoredAt, ...summarize(scores) });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
