import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { appRoute } from "@/lib/route";

const DAY_MS = 86_400_000;
const dayKey = (d) => d.toISOString().slice(0, 10);

// The Results page: the shop's rescue plans (measuring, and those that started in the last 150 days)
// with what changed in each, the visits so far of the ones measuring, and the store's day.
export const GET = appRoute(async ({ shop }) => {
  const today = localDateKey(new Date(), shop.timezone);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 150 * DAY_MS);
  const plans = await db().rescuePlan.findMany({
    where: { product: { shopId: shop.id }, OR: [{ verdict: null }, { startedAt: { gte: since } }] },
    orderBy: { startedAt: "desc" },
    take: 100,
    include: { product: { select: { id: true, title: true, price: true } } },
  });
  const fixIds = plans.flatMap((p) => p.fixIds);
  const measuring = plans.filter((p) => !p.verdict);
  const earliest = measuring.length ? new Date(Math.min(...measuring.map((p) => p.startedAt.getTime()))) : null;
  const [fixes, metrics] = await Promise.all([
    fixIds.length ? db().fix.findMany({ where: { id: { in: fixIds } }, select: { id: true, type: true } }) : [],
    // Visits since each measuring plan started (from the earliest start; each plan sums its own days).
    earliest
      ? db().productDailyMetric.findMany({
          where: { productId: { in: [...new Set(measuring.map((p) => p.productId))] }, date: { gte: earliest }, viewSessions: { gt: 0 } },
          select: { productId: true, date: true, viewSessions: true },
        })
      : [],
  ]);
  const typeOf = new Map(fixes.map((f) => [f.id, f.type]));
  return Response.json({
    currency: shop.currency,
    today,
    plans: plans.map((p) => ({
      id: p.id,
      productId: p.product.id,
      title: p.product.title,
      price: Number(p.product.price),
      startedAt: dayKey(p.startedAt),
      endsAt: p.endsAt ? dayKey(p.endsAt) : null,
      verdict: p.verdict,
      result: p.result,
      extended: Boolean(p.baseline?.extended),
      fixTypes: p.fixIds.map((id) => typeOf.get(id)).filter(Boolean),
      viewsSoFar: p.verdict ? null : metrics.filter((m) => m.productId === p.productId && m.date >= p.startedAt && dayKey(m.date) < today).reduce((n, m) => n + m.viewSessions, 0),
    })),
  });
});
