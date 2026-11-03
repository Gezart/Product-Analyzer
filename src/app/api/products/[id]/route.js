import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { dailySeries, lastSaleDate, trend30, windowTotals } from "@/lib/product-metrics";
import { appRoute } from "@/lib/route";
import { returnRate, returnWindow, topReturnReasons } from "@/lib/returns";
import { formatSeason, seasonOf, seasonState } from "@/lib/season";
import { seasonalCollectionsOf } from "@/lib/settings";
import { stockFromVariants } from "@/lib/scoring";
import { knownOrderDays } from "@/lib/sync/constants";

// One product's analysis: metrics for 30/60/90 days, daily sales, stock, latest score, variants.
export const GET = appRoute(async ({ shop, params }) => {
  const { id } = params;
  const product = await db().product.findFirst({
    where: { id, shopId: shop.id },
    include: {
      variants: { select: { id: true, sku: true, options: true, price: true, cost: true, inventoryQty: true, sellsWhenOut: true }, orderBy: { shopifyGid: "asc" } },
      scores: { orderBy: { computedAt: "desc" }, take: 1 },
      rescuePlans: { orderBy: { startedAt: "desc" }, take: 1 },
      markdownPlans: { where: { status: { in: ["active", "paused"] } }, take: 1, select: { status: true } },
    },
  });
  if (!product) return Response.json({ error: "Not found" }, { status: 404 });

  const today = localDateKey(new Date(), shop.timezone);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 120 * 86_400_000);
  const [metrics, lastSale, ordersSync, webhooks, settings] = await Promise.all([
    db().productDailyMetric.findMany({ where: { productId: id, date: { gte: since } }, orderBy: { date: "asc" } }),
    db().productDailyMetric.findFirst({ where: { productId: id, units: { gt: 0 } }, orderBy: { date: "desc" }, select: { date: true } }),
    db().syncState.findUnique({ where: { shopId_resource: { shopId: shop.id, resource: "orders" } } }),
    db().syncState.findUnique({ where: { shopId_resource: { shopId: shop.id, resource: "webhooks" } } }),
    db().settings.findUnique({ where: { shopId: shop.id }, select: { seasonalCollections: true } }),
  ]);
  // The plan's new places in collections (Collection Optimizer): shown with it, undone on the Collections page.
  const planFixIds = product.rescuePlans[0]?.fixIds ?? [];
  const moves = planFixIds.length
    ? await db().fix.findMany({ where: { id: { in: planFixIds }, type: "position" }, select: { id: true, status: true, before: true, after: true } })
    : [];
  // Returns over the recent days: the product's rate, the store's, and the most common reasons.
  const recent = await returnWindow(shop.id, shop.timezone);
  const [productReturns, storeReturns, returnReasons] = await Promise.all([
    returnRate(shop.id, recent.from, product.shopifyGid),
    returnRate(shop.id, recent.from),
    topReturnReasons(shop.id, recent.from, product.shopifyGid),
  ]);
  const returns = { days: recent.days, ...productReturns, storeRate: storeReturns.rate, reasons: returnReasons };
  // The product's season (its `season:` tag, or a collection marked seasonal) and where today falls in it.
  const seasonFound = seasonOf(product, seasonalCollectionsOf(settings?.seasonalCollections));
  const season = seasonFound && { label: formatSeason(seasonFound.ranges), source: seasonFound.source, ...seasonState(seasonFound.ranges, today) };
  // Windows longer than the known order history would undercount: they are flagged as partial.
  const knownDays = knownOrderDays({
    windowStart: ordersSync?.status === "done" ? ordersSync.lastCursor : null,
    today,
    live: webhooks?.status === "done",
  });
  const rows = metrics.map((m) => ({
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
      season,
    },
    returns,
    score: score
      ? {
          status: score.status,
          moneyAtStake: Number(score.moneyAtStake),
          stockValue: Number(score.stockValue),
          costIsEstimate: score.costIsEstimate,
          sellThrough: score.sellThrough == null ? null : Number(score.sellThrough),
          daysOfCover: score.daysOfCover == null ? null : Number(score.daysOfCover),
          trend: score.trend == null ? null : Number(score.trend),
          rising: score.rising,
          computedAt: score.computedAt,
        }
      : null,
    // Live stock, its value and days of stock (the score is from the last nightly run).
    stock: stock.stock,
    markdownRunning: product.markdownPlans.length > 0,
    // Sold without stock (inventory not tracked, e.g. a gift card, or selling past zero): stock numbers don't apply.
    untracked: product.variants.length > 0 && product.variants.every((v) => v.sellsWhenOut) && stock.stock <= 0,
    stockValue: stock.stockValue,
    stockValueIsEstimate: stock.costIsEstimate,
    daysOfCover: daily30 > 0 ? stock.stock / daily30 : null,
    knownDays,
    windows,
    trend: windows[0].partial || windows[1].partial ? null : trend30(rows, today),
    lastSale: lastSale ? lastSale.date.toISOString().slice(0, 10) : lastSaleDate(rows),
    daily: dailySeries(rows, today, 90, knownDays),
    rescuePlan: product.rescuePlans[0]
      ? {
          startedAt: product.rescuePlans[0].startedAt.toISOString().slice(0, 10),
          // Day of the window in the store's calendar (day 1 = the day of the fix).
          day: Math.round((Date.parse(`${today}T00:00:00Z`) - product.rescuePlans[0].startedAt.getTime()) / 86_400_000) + 1,
          fixIds: product.rescuePlans[0].fixIds,
          hasViews: windows[2].views > 0,
          endsAt: product.rescuePlans[0].endsAt?.toISOString().slice(0, 10) ?? null,
          verdict: product.rescuePlans[0].verdict,
          fixes: product.rescuePlans[0].fixIds.length,
          extended: Boolean(product.rescuePlans[0].baseline?.extended),
          result: product.rescuePlans[0].result,
          moves: moves.map((m) => ({
            fixId: m.id,
            status: m.status,
            collectionTitle: m.after?.collectionTitle ?? "",
            collectionId: String(m.after?.collectionGid ?? "").split("/").pop() || null,
            from: m.before?.position ?? null,
            to: m.after?.position ?? null,
          })),
        }
      : null,
    variants: product.variants.map((v) => ({ id: v.id, sku: v.sku, options: v.options, price: Number(v.price), stock: v.inventoryQty })),
  });
});
