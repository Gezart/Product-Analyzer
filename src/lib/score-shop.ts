import { db } from "@/lib/db";
import { scoreProducts, type ProductInput, type Thresholds } from "@/lib/scoring";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Recomputes metrics, status and money at stake for every active product of a shop
 * and writes one `product_scores` row per product. Returns the number of products scored.
 */
export async function scoreShop(shopId: string, now = new Date()): Promise<number> {
  const today = startOfUtcDay(now);
  const d30 = new Date(today.getTime() - 30 * DAY_MS);
  const d60 = new Date(today.getTime() - 60 * DAY_MS);

  const [settings, products] = await Promise.all([
    db().settings.findUnique({ where: { shopId } }),
    db().product.findMany({
      where: { shopId, status: "ACTIVE" },
      select: { id: true, price: true, cost: true, collections: true, variants: { select: { inventoryQty: true, cost: true } } },
    }),
  ]);

  const excluded = new Set(settings?.excludedCollectionIds ?? []);
  const scored = products.filter((p) => !p.collections.some((c) => excluded.has(c)));
  if (scored.length === 0) return 0;
  const ids = scored.map((p) => p.id);

  const sumWindow = (from: Date, to: Date) =>
    db().productDailyMetric.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, date: { gte: from, lt: to } },
      _sum: { units: true, viewSessions: true, purchaseSessions: true },
    });

  const [last30, prev30, lastSales, firstDay] = await Promise.all([
    sumWindow(d30, today),
    sumWindow(d60, d30),
    db().productDailyMetric.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, units: { gt: 0 } },
      _max: { date: true },
    }),
    db().productDailyMetric.aggregate({ where: { productId: { in: ids } }, _min: { date: true } }),
  ]);

  const byId = <T extends { productId: string }>(rows: T[]) => new Map(rows.map((r) => [r.productId, r]));
  const cur = byId(last30);
  const prev = byId(prev30);
  const lastSale = byId(lastSales);
  const historyDays = firstDay._min.date ? Math.round((today.getTime() - firstDay._min.date.getTime()) / DAY_MS) : 0;

  const inputs: ProductInput[] = scored.map((p) => {
    const variantCosts = p.variants.map((v) => v.cost).filter((c) => c != null).map(Number);
    const c = cur.get(p.id)?._sum;
    const pr = prev.get(p.id)?._sum;
    const saleDate = lastSale.get(p.id)?._max.date;
    const units30 = c?.units ?? 0;
    const unitsPrev30 = pr?.units ?? 0;
    return {
      id: p.id,
      stock: p.variants.reduce((sum, v) => sum + v.inventoryQty, 0),
      price: Number(p.price),
      cost: p.cost != null ? Number(p.cost) : variantCosts.length ? variantCosts.reduce((a, b) => a + b) / variantCosts.length : null,
      units30,
      unitsPrev30,
      units60: units30 + unitsPrev30,
      views30: c?.viewSessions ?? 0,
      purchases30: c?.purchaseSessions ?? 0,
      daysSinceLastSale: saleDate ? Math.round((today.getTime() - saleDate.getTime()) / DAY_MS) : null,
    };
  });

  const thresholds = (settings?.thresholds ?? {}) as Partial<Thresholds>;
  const results = scoreProducts(inputs, thresholds, historyDays);

  await db().productScore.createMany({
    data: results.map((r) => ({
      productId: r.id,
      computedAt: now,
      status: r.status,
      moneyAtStake: r.moneyAtStake.toFixed(2),
      sellThrough: r.sellThrough?.toFixed(4) ?? null,
      daysOfCover: r.daysOfCover?.toFixed(2) ?? null,
      trend: r.trend?.toFixed(4) ?? null,
    })),
  });
  return results.length;
}
