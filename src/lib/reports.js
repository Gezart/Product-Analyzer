import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { hasFeature } from "@/lib/plans";
import { averageCost, dailyBaseline, markdownPeriod, monthlyReport, monthRange, previousMonth } from "@/lib/report";
import { isLocalDate, ORDER_DAYS } from "@/lib/sync/constants";

const DAY_MS = 86_400_000;
const asDate = (key) => new Date(`${key}T00:00:00Z`);
const dateKey = (d) => d.toISOString().slice(0, 10);
const shift = (key, days) => dateKey(new Date(asDate(key).getTime() + days * DAY_MS));

/** Builds a shop's report for `period` ("YYYY-MM") from its plans, fixes and daily metrics. */
export async function buildReport(shopId, period, now = new Date()) {
  const month = monthRange(period);
  const shop = await db().shop.findUniqueOrThrow({ where: { id: shopId }, select: { timezone: true, currency: true } });
  const tz = shop.timezone;
  const today = localDateKey(now, tz);
  const [rescues, markdowns, fixes, orders] = await Promise.all([
    // endsAt = the day after the window: windows that end before this month don't matter.
    db().rescuePlan.findMany({ where: { product: { shopId }, verdict: "improved", endsAt: { gte: asDate(month.from) } }, include: { product: { select: { title: true, shopifyCreatedAt: true } } } }),
    db().markdownPlan.findMany({
      where: {
        product: { shopId },
        currentStep: { gte: 0 },
        startedAt: { lte: asDate(month.to) },
        OR: [{ endedAt: null }, { endedAt: { gte: asDate(shift(month.from, -1)) } }],
      },
      include: { product: { select: { title: true, shopifyCreatedAt: true } } },
    }),
    db().fix.findMany({
      where: { product: { shopId }, appliedAt: { gte: asDate(shift(month.from, -1)), lt: asDate(shift(month.to, 2)) } },
      include: { product: { select: { title: true } } },
      orderBy: { appliedAt: "asc" },
    }),
    db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "orders" } } }),
  ]);
  const ordersFrom = orders?.status === "done" && isLocalDate(orders.lastCursor) ? orders.lastCursor : shift(today, -ORDER_DAYS);
  // Days before the product existed or before order history starts aren't "no sales".
  const historyFrom = (product) => {
    const created = product.shopifyCreatedAt ? localDateKey(product.shopifyCreatedAt, tz) : null;
    return created && created > ordersFrom ? created : ordersFrom;
  };

  const plans = [
    // Windows ending this month are counted; later-ending ones that overlap it keep their days free.
    ...rescues
      .filter((r) => r.result?.window && r.result.window.from <= month.to && r.result.window.to >= month.from)
      .map((r) => ({
        productId: r.productId,
        title: r.product.title,
        kind: "rescue",
        from: r.result.window.from,
        to: r.result.window.to,
        baseline: [r.result.baselineWindow.from, r.result.baselineWindow.to],
      })),
    ...markdowns.map((m) => ({
      productId: m.productId,
      title: m.product.title,
      kind: "markdown",
      ...markdownPeriod({
        startedOn: dateKey(m.startedAt),
        endedOn: m.endedAt ? localDateKey(m.endedAt, tz) : null,
        historyFrom: historyFrom(m.product),
      }),
    })),
  ];
  const productIds = [...new Set(plans.map((p) => p.productId))];
  const earliest = [month.from, ...plans.flatMap((p) => [p.from, p.baseline?.[0] ?? p.from])].sort()[0];
  const [metrics, variants, fixPlans] = await Promise.all([
    db().productDailyMetric.findMany({
      where: { productId: { in: productIds }, date: { gte: asDate(earliest), lte: asDate(month.to) } },
      select: { productId: true, date: true, units: true, revenue: true },
    }),
    db().variant.findMany({ where: { productId: { in: productIds } }, select: { productId: true, cost: true } }),
    db().rescuePlan.findMany({ where: { product: { shopId }, fixIds: { hasSome: fixes.map((f) => f.id) } }, select: { fixIds: true, verdict: true } }),
  ]);
  const daily = new Map(productIds.map((id) => [id, []]));
  for (const m of metrics) daily.get(m.productId).push({ date: dateKey(m.date), units: m.units, revenue: Number(m.revenue) });
  const unitCost = new Map(
    productIds.map((id) => [id, averageCost(variants.filter((v) => v.productId === id).map((v) => (v.cost == null ? null : Number(v.cost))))]),
  );
  const effect = new Map(fixPlans.flatMap((p) => p.fixIds.map((id) => [id, p.verdict ?? "measuring"])));

  const report = monthlyReport({
    period,
    today,
    periods: plans.map((p) => ({ ...p, baselineDaily: p.baseline ? dailyBaseline(daily.get(p.productId), p.baseline[0], p.baseline[1]) : null })),
    daily,
    unitCost,
    fixes: fixes.map((f) => ({
      id: f.id,
      productId: f.productId,
      title: f.product.title,
      type: f.type,
      status: f.status,
      appliedOn: localDateKey(f.appliedAt, tz),
      effect: effect.get(f.id) ?? null,
    })),
  });
  return { ...report, currency: shop.currency };
}

/**
 * Nightly: a finished month's numbers are stored once, on the 2nd (its last rescue verdicts and the
 * order catch-up are in by then), and the merchant is told in the inbox. Months that ended before the
 * install are skipped. The report page always rebuilds from current data; this is a snapshot (a verdict
 * that lands later can still move days between months on the page).
 */
export async function closeMonth(shopId, now = new Date()) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { timezone: true, installedAt: true, plan: true } });
  if (!shop || !hasFeature(shop.plan, "reports")) return;
  const today = localDateKey(now, shop.timezone);
  if (today.slice(8) < "02") return;
  const period = previousMonth(today);
  if (monthRange(period).to < localDateKey(shop.installedAt, shop.timezone)) return;
  if (await db().report.findUnique({ where: { shopId_period: { shopId, period } }, select: { id: true } })) return;
  const r = await buildReport(shopId, period, now);
  try {
    // Stored together, so the inbox item can't be lost between the two.
    await db().$transaction([
      db().report.create({
        data: { shopId, period, revenueRecovered: r.revenueRecovered, stockValueCleared: r.stockValueCleared, productsRescued: r.productsRescued, payload: r },
      }),
      db().notification.create({ data: { shopId, type: "monthly_report", data: { period, revenueRecovered: r.revenueRecovered, currency: r.currency } } }),
    ]);
  } catch (error) {
    if (error?.code === "P2002") return; // stored by a concurrent run
    throw error;
  }
}
