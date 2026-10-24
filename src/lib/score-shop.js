import { db } from "@/lib/db";
import { scoreProducts } from "@/lib/scoring";
import { localDateKey } from "@/lib/jobs/schedule";
import { knownOrderDays } from "@/lib/sync/constants";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recomputes metrics, status and money at stake for every product of a shop and writes one
 * `product_scores` row per product (inactive, deleted or excluded products get status "excluded").
 * Returns the number of products scored (excluded not counted).
 */
export async function scoreShop(shopId, now = new Date()) {
  // "Today" is the store's local date, the same calendar the daily metrics are stored in.
  const shopRow = await db().shop.findUnique({ where: { id: shopId }, select: { timezone: true } });
  const todayKey = localDateKey(now, shopRow?.timezone);
  const today = new Date(`${todayKey}T00:00:00Z`);
  const d30 = new Date(today.getTime() - 30 * DAY_MS);
  const d60 = new Date(today.getTime() - 60 * DAY_MS);
  const daysBefore = (d) => Math.max(0, Math.round((today.getTime() - d.getTime()) / DAY_MS));

  const [settings, ordersSync, webhooks, products] = await Promise.all([
    db().settings.findUnique({ where: { shopId } }),
    db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "orders" } } }),
    db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "webhooks" } } }),
    db().product.findMany({
      where: { shopId },
      select: {
        id: true,
        shopifyGid: true,
        status: true,
        collections: true,
        shopifyCreatedAt: true,
        variants: { select: { inventoryQty: true, price: true, cost: true } },
      },
    }),
  ]);

  const excludedCollections = new Set(settings?.excludedCollectionIds ?? []);
  const excludedProducts = new Set(settings?.excludedProductIds ?? []);
  const isScored = (p) =>
    p.status === "ACTIVE" && !excludedProducts.has(p.shopifyGid) && !p.collections.some((c) => excludedCollections.has(c));
  const scored = products.filter(isScored);
  const excluded = products.filter((p) => !isScored(p));
  const ids = scored.map((p) => p.id);

  const sumWindow = (from, to) =>
    db().productDailyMetric.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, date: { gte: from, lt: to } },
      _sum: { units: true, viewSessions: true, purchaseSessions: true },
    });

  const [last30, prev30, lastSales, firstSeen] = ids.length
    ? await Promise.all([
        sumWindow(d30, today),
        sumWindow(d60, d30),
        db().productDailyMetric.groupBy({
          by: ["productId"],
          where: { productId: { in: ids }, units: { gt: 0 } },
          _max: { date: true },
        }),
        db().productDailyMetric.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _min: { date: true } }),
      ])
    : [[], [], [], []];

  const byId = (rows) => new Map(rows.map((r) => [r.productId, r]));
  const cur = byId(last30);
  const prev = byId(prev30);
  const lastSale = byId(lastSales);
  const first = byId(firstSeen);
  // Order history is known from the imported window's start; it keeps growing only with live sync.
  // (Metric rows can't tell: views go further back and rows exist only for days with activity.)
  const historyDays = knownOrderDays({
    windowStart: ordersSync?.status === "done" ? ordersSync.lastCursor : null,
    today: todayKey,
    live: webhooks?.status === "done",
  });

  const inputs = scored.map((p) => {
    const c = cur.get(p.id)?._sum;
    const pr = prev.get(p.id)?._sum;
    const saleDate = lastSale.get(p.id)?._max.date;
    const created = p.shopifyCreatedAt ?? first.get(p.id)?._min.date ?? null;
    const units30 = c?.units ?? 0;
    const unitsPrev30 = pr?.units ?? 0;
    return {
      id: p.id,
      ...stockFromVariants(
        p.variants.map((v) => ({
          stock: v.inventoryQty,
          price: Number(v.price),
          cost: v.cost != null ? Number(v.cost) : null,
        })),
      ),
      units30,
      unitsPrev30,
      units60: units30 + unitsPrev30,
      views30: c?.viewSessions ?? 0,
      purchases30: c?.purchaseSessions ?? 0,
      daysSinceLastSale: saleDate ? daysBefore(saleDate) : null,
      ageDays: created ? daysBefore(created) : null,
    };
  });

  const results = scoreProducts(inputs, settings?.thresholds, historyDays);

  await db().productScore.createMany({
    data: [
      ...results.map((r) => ({
        productId: r.id,
        computedAt: now,
        status: r.status,
        moneyAtStake: r.moneyAtStake.toFixed(2),
        stockValue: r.stockValue.toFixed(2),
        costIsEstimate: r.costIsEstimate,
        sellThrough: r.sellThrough?.toFixed(4) ?? null,
        // Capped so extreme stock with almost no sales fits Decimal(10,2).
        daysOfCover: r.daysOfCover != null ? Math.min(r.daysOfCover, 99999).toFixed(2) : null,
        trend: r.trend?.toFixed(4) ?? null,
      })),
      ...excluded.map((p) => ({ productId: p.id, computedAt: now, status: "excluded", moneyAtStake: "0.00" })),
    ],
  });
  return results.length;
}
