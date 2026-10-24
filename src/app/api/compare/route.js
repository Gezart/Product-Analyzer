import { authenticate, AuthError } from "@/lib/auth";
import { grossMargin, pageQuality, parseCompareIds, stockAge } from "@/lib/compare";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { windowTotals } from "@/lib/product-metrics";
import { stockFromVariants } from "@/lib/scoring";
import { knownOrderDays } from "@/lib/sync/constants";

const WINDOWS = [30, 60, 90];

/**
 * Up to 4 products side by side over 30/60/90 days (`days`): sales, views, conversion, price, margin,
 * stock, stock age, page quality. `ids`: product ids or Shopify GIDs (from the resource picker).
 */
export async function GET(request) {
  try {
    const { shop } = await authenticate(request);
    const url = new URL(request.url);
    const ids = parseCompareIds(url.searchParams.get("ids"));
    if (!ids) return Response.json({ error: "Pick 1 to 4 products" }, { status: 400 });
    const days = WINDOWS.includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;

    const products = await db().product.findMany({
      where: { shopId: shop.id, OR: [{ id: { in: ids } }, { shopifyGid: { in: ids } }] },
      include: {
        variants: { select: { price: true, cost: true, inventoryQty: true } },
        scores: { orderBy: { computedAt: "desc" }, take: 1, select: { status: true } },
      },
    });
    const productIds = products.map((p) => p.id);
    const today = localDateKey(new Date(), shop.timezone);
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000);
    const [metrics, lastSales, ordersSync, webhooks] = await Promise.all([
      db().productDailyMetric.findMany({ where: { productId: { in: productIds }, date: { gte: since } } }),
      db().productDailyMetric.groupBy({ by: ["productId"], where: { productId: { in: productIds }, units: { gt: 0 } }, _max: { date: true } }),
      db().syncState.findUnique({ where: { shopId_resource: { shopId: shop.id, resource: "orders" } } }),
      db().syncState.findUnique({ where: { shopId_resource: { shopId: shop.id, resource: "webhooks" } } }),
    ]);
    const knownDays = knownOrderDays({
      windowStart: ordersSync?.status === "done" ? ordersSync.lastCursor : null,
      today,
      live: webhooks?.status === "done",
    });
    const lastSale = new Map(lastSales.map((r) => [r.productId, r._max.date?.toISOString().slice(0, 10) ?? null]));
    // Columns in the order the merchant picked them.
    const position = (p) => Math.min(...[ids.indexOf(p.id), ids.indexOf(p.shopifyGid)].filter((i) => i >= 0));
    products.sort((a, b) => position(a) - position(b));

    return Response.json({
      currency: shop.currency,
      days,
      // A window longer than the known order history would undercount sales.
      partial: days > knownDays,
      notFound: ids.filter((i) => !products.some((p) => p.id === i || p.shopifyGid === i)).length,
      products: products.map((p) => {
        const rows = metrics
          .filter((m) => m.productId === p.id)
          .map((m) => ({
            date: m.date.toISOString().slice(0, 10),
            units: m.units,
            revenue: Number(m.revenue),
            viewSessions: m.viewSessions,
            cartSessions: m.cartSessions,
            purchaseSessions: m.purchaseSessions,
          }));
        const totals = windowTotals(rows, today, days);
        const variants = p.variants.map((v) => ({ price: Number(v.price), cost: v.cost == null ? null : Number(v.cost), stock: v.inventoryQty }));
        const stock = stockFromVariants(variants);
        return {
          id: p.id,
          shopifyGid: p.shopifyGid,
          title: p.title,
          status: p.status,
          scoreStatus: p.scores[0]?.status ?? null,
          price: Number(p.price),
          compareAtPrice: p.compareAtPrice == null ? null : Number(p.compareAtPrice),
          units: totals.units,
          revenue: totals.revenue,
          views: totals.views,
          conversion: totals.viewToPurchase,
          ...grossMargin(variants),
          stock: stock.stock,
          stockValue: stock.stockValue,
          stockValueIsEstimate: stock.costIsEstimate,
          stockAge: stockAge({
            today,
            lastSale: lastSale.get(p.id) ?? null,
            createdAt: p.shopifyCreatedAt ? localDateKey(p.shopifyCreatedAt, shop.timezone) : null,
            knownDays,
          }),
          // Rows synced before the text was stored have words but no text (same rule as the diagnosis).
          pageQuality: pageQuality({ ...p, collections: p.collections.length, pageDataKnown: p.description != null || p.descriptionWords === 0 }),
        };
      }),
    });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
