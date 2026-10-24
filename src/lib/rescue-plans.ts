import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { evaluateWindow, WINDOW, type Day, type StoreDay } from "@/lib/rescue";
import { isLocalDate, ORDER_DAYS } from "@/lib/sync/constants";

const DAY_MS = 86_400_000;
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (key: string) => new Date(`${key}T00:00:00Z`);

type PlanState = { extended: boolean };

async function today(shopId: string) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { timezone: true } });
  return localDateKey(new Date(), shop?.timezone);
}

/**
 * After a fix is applied: the product's measurement window starts today. A fix during an open window
 * restarts it (the effect can't be told apart otherwise) and is added to the same plan.
 */
export async function startRescuePlan(shopId: string, productId: string, fixId: string) {
  const start = await today(shopId);
  const open = await db().rescuePlan.findFirst({ where: { productId, verdict: null }, orderBy: { startedAt: "desc" } });
  const data = {
    startedAt: asDate(start),
    endsAt: new Date(asDate(start).getTime() + WINDOW.maxDays * DAY_MS),
    baseline: { extended: false } satisfies PlanState,
  };
  if (open) {
    await db().rescuePlan.update({ where: { id: open.id }, data: { ...data, fixIds: [...new Set([...open.fixIds, fixId])] } });
  } else {
    await db().rescuePlan.create({ data: { productId, fixIds: [fixId], ...data } });
  }
}

/** After an undo: the fix leaves its open plan; a plan with no fixes left is cancelled. */
export async function removeFromRescuePlan(productId: string, fixId: string) {
  const open = await db().rescuePlan.findFirst({ where: { productId, verdict: null, fixIds: { has: fixId } } });
  if (!open) return;
  const fixIds = open.fixIds.filter((id) => id !== fixId);
  await db().rescuePlan.update({ where: { id: open.id }, data: fixIds.length ? { fixIds } : { fixIds, verdict: "cancelled" } });
}

/** Job "rescue-runner" (hourly): evaluates every open window of a shop, extending or closing it. */
export async function runRescuePlans(shopId: string) {
  const plans = await db().rescuePlan.findMany({ where: { verdict: null, product: { shopId } } });
  if (plans.length === 0) return;
  const todayKey = await today(shopId);
  const orders = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "orders" } } });
  const historyFrom =
    orders?.status === "done" && isLocalDate(orders.lastCursor)
      ? orders.lastCursor
      : dateKey(new Date(asDate(todayKey).getTime() - ORDER_DAYS * DAY_MS));

  const earliest = new Date(Math.min(...plans.map((p) => p.startedAt.getTime())) - 2 * WINDOW.maxDays * DAY_MS);
  const storeRows = await db().productDailyMetric.groupBy({
    by: ["date"],
    where: { product: { shopId }, date: { gte: earliest } },
    _sum: { units: true, viewSessions: true },
  });
  const store: StoreDay[] = storeRows.map((r) => ({ date: dateKey(r.date), units: r._sum.units ?? 0, views: r._sum.viewSessions ?? 0 }));

  for (const plan of plans) {
    const rows = await db().productDailyMetric.findMany({
      where: { productId: plan.productId, date: { gte: new Date(plan.startedAt.getTime() - 2 * WINDOW.maxDays * DAY_MS) } },
      select: { date: true, units: true, viewSessions: true, purchaseSessions: true },
    });
    const product: Day[] = rows.map((r) => ({ date: dateKey(r.date), units: r.units, views: r.viewSessions, purchases: r.purchaseSessions }));
    const state = (plan.baseline ?? { extended: false }) as PlanState;
    const result = evaluateWindow({
      start: dateKey(plan.startedAt),
      today: todayKey,
      product,
      store,
      extended: state.extended,
      historyFrom,
    });

    if (result.status === "extend") {
      await db().rescuePlan.update({
        where: { id: plan.id },
        data: { baseline: { extended: true }, endsAt: new Date(plan.startedAt.getTime() + 2 * WINDOW.maxDays * DAY_MS) },
      });
    } else if (result.status === "done") {
      await db().rescuePlan.update({
        where: { id: plan.id },
        data: { verdict: result.verdict, result, endsAt: new Date(asDate(result.window.to).getTime() + DAY_MS) },
      });
    }
  }
}
