import { db } from "@/lib/db";
import { scoreProducts, stockFromVariants, type ProductInput } from "@/lib/scoring";
import { ORDER_DAYS } from "@/lib/sync/constants";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Recomputes metrics, status and money at stake for every product of a shop and writes one
 * `product_scores` row per product (inactive, deleted or excluded products get status "excluded").
 * Returns the number of products scored (excluded not counted).
 */
export async function scoreShop(shopId: string, now = new Date()): Promise<number> {
  const today = startOfUtcDay(now);
  const d30 = new Date(today.getTime() - 30 * DAY_MS);
  const d60 = new Date(today.getTime() - 60 * DAY_MS);
  const daysBefore = (d: Date) => Math.max(0, Math.round((today.getTime() - d.getTime()) / DAY_MS));

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
  const isScored = (p: (typeof products)[number]) =>
    p.status === "ACTIVE" && !excludedProducts.has(p.shopifyGid) && !p.collections.some((c) => excludedCollections.has(c));
  const scored = products.filter(isScored);
  const excluded = products.filter((p) => !isScored(p));
  const ids = scored.map((p) => p.id);

  const sumWindow = (from: Date, to: Date) =>
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

  const byId = <T extends { productId: string }>(rows: T[]) => new Map(rows.map((r) => [r.productId, r]));
  const cur = byId(last30);
  const prev = byId(prev30);
  const lastSale = byId(lastSales);
  const first = byId(firstSeen);
  const firstDates = firstSeen.map((r) => r._min.date).filter((d): d is Date => d != null);
  // Rows exist only for days with activity, so the synced order window counts too; with live order
  // webhooks the known history keeps growing after the import.
  const fromRows = firstDates.length ? daysBefore(new Date(Math.min(...firstDates.map((d) => d.getTime())))) : 0;
  const ordersDone = ordersSync?.status === "done" && ordersSync.lastSyncedAt;
  const live = webhooks?.status === "done";
  const fromSync = ordersDone ? ORDER_DAYS + (live ? daysBefore(ordersSync.lastSyncedAt!) : 0) : 0;
  const historyDays = Math.max(fromRows, fromSync);

  const inputs: ProductInput[] = scored.map((p) => {
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
