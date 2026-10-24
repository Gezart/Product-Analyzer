import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { dailySeries, lastSaleDate, windowTotals, type DailyRow } from "@/lib/product-metrics";

// One product's analysis: metrics for 30/60/90 days, daily sales, stock, latest score, variants.
export async function GET(request: Request, ctx: RouteContext<"/api/products/[id]">) {
  try {
    const { shop } = await authenticate(request);
    const { id } = await ctx.params;
    const product = await db().product.findFirst({
      where: { id, shopId: shop.id },
      include: {
        variants: { select: { id: true, sku: true, options: true, price: true, inventoryQty: true }, orderBy: { shopifyGid: "asc" } },
        scores: { orderBy: { computedAt: "desc" }, take: 1 },
      },
    });
    if (!product) return new Response("Not found", { status: 404 });

    const today = localDateKey(new Date(), shop.timezone);
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 120 * 86_400_000);
    const [metrics, lastSale] = await Promise.all([
      db().productDailyMetric.findMany({ where: { productId: id, date: { gte: since } }, orderBy: { date: "asc" } }),
      db().productDailyMetric.findFirst({ where: { productId: id, units: { gt: 0 } }, orderBy: { date: "desc" }, select: { date: true } }),
    ]);
    const rows: DailyRow[] = metrics.map((m) => ({
      date: m.date.toISOString().slice(0, 10),
      units: m.units,
      revenue: Number(m.revenue),
      viewSessions: m.viewSessions,
      cartSessions: m.cartSessions,
      purchaseSessions: m.purchaseSessions,
    }));
    const score = product.scores[0];
    const w30 = windowTotals(rows, today, 30);
    const w60 = windowTotals(rows, today, 60);
    const prev30 = w60.units - w30.units;

    return Response.json({
      currency: shop.currency,
      product: { id: product.id, title: product.title, handle: product.handle, status: product.status, price: Number(product.price) },
      score: score
        ? {
            status: score.status,
            moneyAtStake: Number(score.moneyAtStake),
            stockValue: Number(score.stockValue),
            costIsEstimate: score.costIsEstimate,
            sellThrough: score.sellThrough == null ? null : Number(score.sellThrough),
            daysOfCover: score.daysOfCover == null ? null : Number(score.daysOfCover),
            trend: score.trend == null ? null : Number(score.trend),
            computedAt: score.computedAt,
          }
        : null,
      stock: product.variants.reduce((sum, v) => sum + Math.max(0, v.inventoryQty), 0),
      windows: [w30, w60, windowTotals(rows, today, 90)],
      trend: prev30 > 0 ? w30.units / prev30 : null,
      lastSale: lastSale ? lastSale.date.toISOString().slice(0, 10) : lastSaleDate(rows),
      daily: dailySeries(rows, today, 90),
      variants: product.variants.map((v) => ({ id: v.id, sku: v.sku, options: v.options, price: Number(v.price), stock: v.inventoryQty })),
    });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
