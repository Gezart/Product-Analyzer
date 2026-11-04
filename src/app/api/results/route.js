import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { liveTotals } from "@/lib/results";
import { appRoute } from "@/lib/route";

const DAY_MS = 86_400_000;
const dayKey = (d) => d.toISOString().slice(0, 10);
const FINISHED = ["improved", "no_change", "worse"];

// The Results page: every measuring rescue plan of the shop and the finished ones that started in the
// last 150 days (newest 100), with what changed, the window so far, and what can still be done; plus
// the counts (measuring now, verdicts of windows that ended in the last 90 days), counted in full.
export const GET = appRoute(async ({ shop }) => {
  const today = localDateKey(new Date(), shop.timezone);
  const todayDate = new Date(`${today}T00:00:00Z`);
  const ofShop = { product: { shopId: shop.id } };
  const include = { product: { select: { id: true, title: true, price: true, status: true } } };
  const [measuring, finished, measuringCount, verdictCounts] = await Promise.all([
    db().rescuePlan.findMany({ where: { ...ofShop, verdict: null }, orderBy: { startedAt: "desc" }, include }),
    db().rescuePlan.findMany({
      where: { ...ofShop, verdict: { not: null }, startedAt: { gte: new Date(todayDate.getTime() - 150 * DAY_MS) } },
      orderBy: { startedAt: "desc" },
      take: 100,
      include,
    }),
    db().rescuePlan.count({ where: { ...ofShop, verdict: null } }),
    // A finished plan's `endsAt` is the day after its window's last day.
    db().rescuePlan.groupBy({ by: ["verdict"], where: { ...ofShop, verdict: { in: FINISHED }, endsAt: { gt: new Date(todayDate.getTime() - 90 * DAY_MS) } }, _count: { _all: true } }),
  ]);
  const plans = [...measuring, ...finished].sort((a, b) => b.startedAt - a.startedAt);
  const productIds = [...new Set(plans.map((p) => p.productId))];
  const fixIds = plans.flatMap((p) => p.fixIds);
  // Visits and purchases around each measuring plan: the days since it started, and as many before its
  // baseline's end (the first fix's day, for a plan restarted by later fixes).
  const fromOf = (p) => {
    const baselineEnd = /^\d{4}-\d{2}-\d{2}$/.test(p.baseline?.baselineEnd ?? "") ? new Date(`${p.baseline.baselineEnd}T00:00:00Z`) : p.startedAt;
    return Math.min(baselineEnd.getTime(), p.startedAt.getTime()) - Math.max(1, (todayDate - p.startedAt) / DAY_MS) * DAY_MS;
  };
  const earliest = measuring.length ? new Date(Math.min(...measuring.map(fromOf))) : null;
  const [fixes, metrics, markdowns] = await Promise.all([
    fixIds.length ? db().fix.findMany({ where: { id: { in: fixIds } }, select: { id: true, type: true, status: true } }) : [],
    earliest
      ? db().productDailyMetric.findMany({
          where: { productId: { in: [...new Set(measuring.map((p) => p.productId))] }, date: { gte: earliest, lt: todayDate } },
          select: { productId: true, date: true, viewSessions: true, purchaseSessions: true },
        })
      : [],
    productIds.length ? db().markdownPlan.findMany({ where: { productId: { in: productIds } }, select: { productId: true, startedAt: true } }) : [],
  ]);
  const fixById = new Map(fixes.map((f) => [f.id, f]));
  // Each product's newest plan: only it is shown (and can be acted on) on the product page.
  const newest = new Map();
  for (const p of plans) if (!newest.has(p.productId)) newest.set(p.productId, p.id);
  const counts = Object.fromEntries(verdictCounts.map((r) => [r.verdict, r._count._all]));

  return Response.json({
    currency: shop.currency,
    today,
    summary: { measuring: measuringCount, improved: counts.improved ?? 0, noChange: counts.no_change ?? 0, worse: counts.worse ?? 0 },
    plans: plans.map((p) => {
      const planFixes = p.fixIds.map((id) => fixById.get(id)).filter(Boolean);
      const latest = newest.get(p.productId) === p.id;
      const live = p.product.status !== "DELETED";
      const rows = p.verdict
        ? []
        : metrics.filter((m) => m.productId === p.productId).map((m) => ({ date: dayKey(m.date), views: m.viewSessions, purchases: m.purchaseSessions }));
      return {
        id: p.id,
        productId: p.product.id,
        title: p.product.title,
        price: Number(p.product.price),
        startedAt: dayKey(p.startedAt),
        endsAt: p.endsAt ? dayKey(p.endsAt) : null,
        verdict: p.verdict,
        result: p.result,
        extended: Boolean(p.baseline?.extended),
        fixTypes: planFixes.map((f) => f.type),
        live: p.verdict ? null : liveTotals(rows, { start: dayKey(p.startedAt), baselineEnd: p.baseline?.baselineEnd ?? dayKey(p.startedAt), today }),
        // What's next, only while it still applies: a fix still in place to undo, or a markdown not started since.
        undoable: latest && live && planFixes.some((f) => f.status === "applied"),
        markdownable: latest && p.product.status === "ACTIVE" && !markdowns.some((m) => m.productId === p.productId && m.startedAt && m.startedAt >= p.startedAt),
      };
    }),
  });
});
