import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { dailySeries, lastSaleDate, trend30, windowTotals, type DailyRow } from "@/lib/product-metrics";
import { stockFromVariants } from "@/lib/scoring";
import { knownOrderDays } from "@/lib/sync/constants";

// One product's analysis: metrics for 30/60/90 days, daily sales, stock, latest score, variants.
export async function GET(request: Request, ctx: RouteContext<"/api/products/[id]">) {
  try {
    const { shop } = await authenticate(request);
    const { id } = await ctx.params;
    const product = await db().product.findFirst({
      where: { id, shopId: shop.id },
      include: {
        variants: { select: { id: true, sku: true, options: true, price: true, cost: true, inventoryQty: true }, orderBy: { shopifyGid: "asc" } },
        scores: { orderBy: { computedAt: "desc" }, take: 1 },
      },
    });
    if (!product) return new Response("Not found", { status: 404 });

    const today = localDateKey(new Date(), shop.timezone);
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 120 * 86_400_000);
    const [metrics, lastSale, ordersSync, webhooks] = await Promise.all([
      db().productDailyMetric.findMany({ where: { productId: id, date: { gte: since } }, orderBy: { date: "asc" } }),
      db().productDailyMetric.findFirst({ where: { productId: id, units: { gt: 0 } }, orderBy: { date: "desc" }, select: { date: true } }),
      db().syncState.findUnique({ where: { shopId_resource: { shopId: shop.id, resource: "orders" } } }),
      db().syncState.findUnique({ where: { shopId_resource: { shopId: shop.id, resource: "webhooks" } } }),
    ]);
    // Windows longer than the known order history would undercount: they are flagged as partial.
    const knownDays = knownOrderDays({
      windowStart: ordersSync?.status === "done" ? ordersSync.lastCursor : null,
      today,
      live: webhooks?.status === "done",
    });
    const rows: DailyRow[] = metrics.map((m) => ({
      date: m.date.toISOString().slice(0, 10),
      units: m.units,
      revenue: Number(m.revenue),
      viewSessions: m.viewSessions,
      cartSessions: m.cartSessions,
      purchaseSessions: m.purchaseSessions,
    }));
    const score = product.scores[0];
    const windows = [30, 60, 90].map((days) => ({ ...windowTotals(rows, today, days), partial: days > knownDays }));
    const stock = stockFromVariants(
      product.variants.map((v) => ({ stock: v.inventoryQty, price: Number(v.price), cost: v.cost == null ? null : Number(v.cost) })),
    );
    const daily30 = windows[0].units / 30;

    return Response.json({
      currency: shop.currency,
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        status: product.status,
        price: Number(product.price),
        productType: product.productType,
        collections: product.collections.length,
        imageCount: product.imageCount,
        descriptionWords: product.descriptionWords,
        seoTitle: product.seoTitle,
        seoDescription: product.seoDescription,
        descriptionPreview: product.description?.slice(0, 400) ?? null,
      },
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
      // Live stock, its value and days of stock (the score is from the last nightly run).
      stock: stock.stock,
      stockValue: stock.stockValue,
      stockValueIsEstimate: stock.costIsEstimate,
      daysOfCover: daily30 > 0 ? stock.stock / daily30 : null,
      knownDays,
      windows,
      trend: windows[0].partial || windows[1].partial ? null : trend30(rows, today),
      lastSale: lastSale ? lastSale.date.toISOString().slice(0, 10) : lastSaleDate(rows),
      daily: dailySeries(rows, today, 90, knownDays),
      variants: product.variants.map((v) => ({ id: v.id, sku: v.sku, options: v.options, price: Number(v.price), stock: v.inventoryQty })),
    });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
