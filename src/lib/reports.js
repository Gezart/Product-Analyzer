import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { notify } from "@/lib/notify";
import { dailyBaseline, monthlyReport, monthRange, previousMonth } from "@/lib/report";
import { isLocalDate, ORDER_DAYS } from "@/lib/sync/constants";

const DAY_MS = 86_400_000;
/** Markdown baseline: revenue in the 30 days before the plan started (within the known history). */
const MARKDOWN_BASELINE_DAYS = 30;
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
    db().rescuePlan.findMany({ where: { product: { shopId }, verdict: "improved" }, include: { product: { select: { title: true, shopifyCreatedAt: true } } } }),
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
    ...markdowns.map((m) => {
      const from = dateKey(m.startedAt);
      const start = [shift(from, -MARKDOWN_BASELINE_DAYS), historyFrom(m.product)].sort()[1];
      return {
        productId: m.productId,
        title: m.product.title,
        kind: "markdown",
        from,
        // Until the day before it ended (prices were restored that day), or open while it runs.
        to: m.endedAt ? shift(localDateKey(m.endedAt, tz), -1) : month.to,
        baseline: [start, shift(from, -1)],
      };
    }),
  ];
  const productIds = [...new Set(plans.map((p) => p.productId))];
  const earliest = [month.from, ...plans.map((p) => p.baseline[0])].sort()[0];
  const [metrics, variants, fixPlans] = await Promise.all([
    db().productDailyMetric.findMany({
      where: { productId: { in: productIds }, date: { gte: asDate(earliest), lte: asDate(month.to) } },
      select: { productId: true, date: true, units: true, revenue: true },
    }),
    db().variant.findMany({ where: { productId: { in: productIds } }, select: { productId: true, cost: true } }),
    db().rescuePlan.findMany({ where: { fixIds: { hasSome: fixes.map((f) => f.id) } }, select: { fixIds: true, verdict: true } }),
  ]);
  const daily = new Map(productIds.map((id) => [id, []]));
  for (const m of metrics) daily.get(m.productId).push({ date: dateKey(m.date), units: m.units, revenue: Number(m.revenue) });
  const unitCost = new Map(
    productIds.map((id) => {
      const costs = variants.filter((v) => v.productId === id && v.cost != null && Number(v.cost) > 0).map((v) => Number(v.cost));
      return [id, costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : null];
    }),
  );
  const effect = new Map(fixPlans.flatMap((p) => p.fixIds.map((id) => [id, p.verdict ?? "measuring"])));

  const report = monthlyReport({
    period,
    today,
    periods: plans.map((p) => ({ ...p, baselineDaily: dailyBaseline(daily.get(p.productId), p.baseline[0], p.baseline[1]) })),
    daily,
    unitCost,
    rescued: rescues.map((r) => ({ productId: r.productId, title: r.product.title, windowEnd: r.result?.window?.to ?? "" })),
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
 * Nightly: once a month is over, its report is stored (from 06:00, after the order catch-up filled
 * its last day) and the merchant is told. Months that ended before the install are skipped.
 */
export async function closeMonth(shopId, now = new Date()) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { timezone: true, installedAt: true } });
  if (!shop) return;
  const period = previousMonth(localDateKey(now, shop.timezone));
  if (monthRange(period).to < localDateKey(shop.installedAt, shop.timezone)) return;
  if (await db().report.findUnique({ where: { shopId_period: { shopId, period } }, select: { id: true } })) return;
  const r = await buildReport(shopId, period, now);
  try {
    await db().report.create({
      data: { shopId, period, revenueRecovered: r.revenueRecovered, stockValueCleared: r.stockValueCleared, productsRescued: r.productsRescued, payload: r },
    });
  } catch (error) {
    if (error?.code === "P2002") return; // stored by a concurrent run
    throw error;
  }
  await notify({ shopId, type: "monthly_report", data: { period, revenueRecovered: r.revenueRecovered, currency: r.currency } });
}
