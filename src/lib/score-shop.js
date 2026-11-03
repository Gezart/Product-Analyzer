import { DAY_MS } from "@/lib/dates";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { attentionSummary } from "@/lib/notifications";
import { notify } from "@/lib/notify";
import { productLimit, withinLimit } from "@/lib/plans";
import { seasonNotices, seasonOf, seasonState, unitsSinceStart } from "@/lib/season";
import { scoreProducts, stockFromVariants } from "@/lib/scoring";
import { seasonalCollectionsOf } from "@/lib/settings";
import { knownOrderDays } from "@/lib/sync/constants";

/** Stock and its value from the product's variants. */
function stockOf(p) {
  return stockFromVariants(p.variants.map((v) => ({ stock: v.inventoryQty, price: Number(v.price), cost: v.cost == null ? null : Number(v.cost) })));
}

/** Stock value columns of a score row. */
function stockColumns(p) {
  const s = stockOf(p);
  return { stockValue: s.stockValue.toFixed(2), costIsEstimate: s.costIsEstimate };
}

/**
 * Inbox notes about seasons, each once: a season starting within 30 days ("check stock and pages"), and
 * a season that just ended with stock left ("an end-of-season markdown clears it").
 */
async function notifySeasons(shopId, items, currency, now) {
  const { soon, ended } = seasonNotices(items);
  if (!soon.length && !ended.length) return;
  const sent = new Set(
    (
      await db().notification.findMany({
        where: { shopId, type: { in: ["season_soon", "season_ended"] }, createdAt: { gte: new Date(now.getTime() - 400 * DAY_MS) } },
        select: { data: true },
      })
    ).map((n) => n.data?.key),
  );
  const notes = [
    ...soon.map((g) => ({ type: "season_soon", key: `soon:${g.date}`, g })),
    ...ended.map((g) => ({ type: "season_ended", key: `ended:${g.date}`, g })),
  ];
  for (const { type, key, g } of notes) {
    if (sent.has(key)) continue;
    await notify({
      shopId,
      type,
      // One product: the note opens it; several: the list of seasonal products.
      productId: g.count === 1 ? g.productIds[0] : null,
      data: { key, date: g.date, days: g.days, count: g.count, stockValue: g.stockValue, currency },
    });
  }
}

/**
 * Recomputes metrics, status and money at stake for every product of a shop and writes one
 * `product_scores` row per product (inactive, deleted or excluded products get status "excluded";
 * products beyond the plan's limit get "over_limit"). Returns the number of products scored.
 */
export async function scoreShop(shopId, now = new Date()) {
  // "Today" is the store's local date, the same calendar the daily metrics are stored in.
  const shopRow = await db().shop.findUnique({ where: { id: shopId }, select: { timezone: true, plan: true, currency: true } });
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
        tags: true,
        shopifyCreatedAt: true,
        variants: { select: { inventoryQty: true, price: true, cost: true, sellsWhenOut: true } },
      },
    }),
  ]);

  const excludedCollections = new Set(settings?.excludedCollectionIds ?? []);
  const excludedProducts = new Set(settings?.excludedProductIds ?? []);
  const isScored = (p) =>
    p.status === "ACTIVE" && !excludedProducts.has(p.shopifyGid) && !p.collections.some((c) => excludedCollections.has(c));
  // Each product's status before this run: keeps the plan's selection stable and tells the merchant
  // what newly needs attention.
  const previous = new Map(
    (
      await db().$queryRaw`
        SELECT p."id" AS "productId", s."status"
        FROM "products" p
        CROSS JOIN LATERAL (
          SELECT x."status" FROM "product_scores" x WHERE x."product_id" = p."id" ORDER BY x."computed_at" DESC LIMIT 1
        ) s
        WHERE p."shop_id" = ${shopId}`
    ).map((r) => [r.productId, r.status]),
  );

  const eligible = products.filter(isScored);
  const excluded = products.filter((p) => !isScored(p));
  // Over the plan's product limit: the products with the most money in stock are analyzed.
  const keep = withinLimit(
    eligible.map((p) => ({
      id: p.id,
      stockValue: stockOf(p).stockValue,
    })),
    productLimit(shopRow?.plan),
    new Set([...previous].filter(([, status]) => status !== "over_limit" && status !== "excluded").map(([id]) => id)),
  );
  const scored = eligible.filter((p) => keep.has(p.id));
  const overLimit = eligible.filter((p) => !keep.has(p.id));
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

  // Seasonal products: where today falls in each one's season. Early in a season (under 60 days) its
  // sell-through counts only the season so far, not the empty weeks before it.
  const seasonalCollections = seasonalCollectionsOf(settings?.seasonalCollections);
  const seasons = new Map();
  for (const p of scored) {
    const season = seasonOf(p, seasonalCollections);
    const state = season && seasonState(season.ranges, todayKey);
    if (state) seasons.set(p.id, state);
  }
  const early = [...seasons].filter(([, s]) => s.inSeason && s.daysIntoSeason < 60);
  const seasonUnits = new Map();
  if (early.length) {
    const rows = await db().productDailyMetric.findMany({
      where: { productId: { in: early.map(([id]) => id) }, date: { gte: d60, lt: today }, units: { gt: 0 } },
      select: { productId: true, date: true, units: true },
    });
    for (const [id, units] of unitsSinceStart(rows, new Map(early.map(([pid, s]) => [pid, s.start])))) seasonUnits.set(id, units);
  }

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
    const season = seasons.get(p.id) ?? null;
    const seasonSoFar = season?.inSeason && season.daysIntoSeason < 60;
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
      units60: seasonSoFar ? (seasonUnits.get(p.id) ?? 0) : units30 + unitsPrev30,
      views30: c?.viewSessions ?? 0,
      purchases30: c?.purchaseSessions ?? 0,
      daysSinceLastSale: saleDate ? daysBefore(saleDate) : null,
      ageDays: created ? daysBefore(created) : null,
      sellsWhenOut: p.variants.length > 0 && p.variants.every((v) => v.sellsWhenOut),
      season: season && { inSeason: season.inSeason, daysIntoSeason: season.daysIntoSeason ?? null, seasonDays: season.seasonDays ?? null },
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
      // Not analyzed, but their stock value still shows in the product list.
      ...excluded.map((p) => ({ productId: p.id, computedAt: now, status: "excluded", moneyAtStake: "0.00", ...stockColumns(p) })),
      ...overLimit.map((p) => ({ productId: p.id, computedAt: now, status: "over_limit", moneyAtStake: "0.00", ...stockColumns(p) })),
    ],
  });
  await notifySeasons(shopId, inputs.map((p) => ({ id: p.id, stock: p.stock, stockValue: p.stockValue, state: seasons.get(p.id) })), shopRow?.currency ?? null, now);

  const summary = attentionSummary(previous, results);
  // The first analysis is the first run that scored a product (none yet, or all excluded: nothing to report).
  if (summary.firstRun && results.length > 0) await notify({ shopId, type: "analysis_ready", data: { products: results.length, counts: summary.counts } });
  else if (!summary.firstRun && summary.total) await notify({ shopId, type: "new_attention", data: { counts: summary.counts } });
  return results.length;
}
