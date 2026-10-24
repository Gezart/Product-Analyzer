import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { evaluateWindow, WINDOW } from "@/lib/rescue";
import { isLocalDate, ORDER_DAYS } from "@/lib/sync/constants";

const DAY_MS = 86_400_000;
const dateKey = (d) => d.toISOString().slice(0, 10);
const asDate = (key) => new Date(`${key}T00:00:00Z`);

/** Windows close only after the nightly order catch-up (04:00 store time) has filled the last day. */
const CLOSE_AFTER_HOUR = 5;

async function shopTime(shopId) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { timezone: true } });
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: shop?.timezone ?? "UTC", hour: "numeric", hourCycle: "h23" }).format(now));
  return { today: localDateKey(now, shop?.timezone), hour };
}

/**
 * After a fix is applied: the product's measurement window starts today. A fix during an open window
 * restarts it and joins the same plan; the baseline stays before the first fix (`baseline.baselineEnd`
 * is the first fix's day).
 */
export async function startRescuePlan(shopId, productId, fixId) {
  const { today } = await shopTime(shopId);
  const open = await db().rescuePlan.findFirst({ where: { productId, verdict: null }, orderBy: { startedAt: "desc" } });
  const window = { startedAt: asDate(today), endsAt: new Date(asDate(today).getTime() + WINDOW.maxDays * DAY_MS) };
  if (open) {
    const prior = (open.baseline ?? {});
    const baselineEnd = isLocalDate(prior.baselineEnd) ? prior.baselineEnd : dateKey(open.startedAt);
    await db().rescuePlan.update({
      where: { id: open.id },
      data: { ...window, baseline: { extended: false, baselineEnd }, fixIds: [...new Set([...open.fixIds, fixId])] },
    });
  } else {
    await db().rescuePlan.create({
      data: { productId, fixIds: [fixId], ...window, baseline: { extended: false, baselineEnd: today } },
    });
  }
}

/** After an undo: the fix leaves its open plan; a plan with no fixes left is cancelled. */
export async function removeFromRescuePlan(productId, fixId) {
  const open = await db().rescuePlan.findFirst({ where: { productId, verdict: null, fixIds: { has: fixId } } });
  if (!open) return;
  const fixIds = open.fixIds.filter((id) => id !== fixId);
  await db().rescuePlan.updateMany({
    where: { id: open.id, verdict: null },
    data: fixIds.length ? { fixIds } : { fixIds, verdict: "cancelled" },
  });
}

/** Job "rescue-runner" (hourly): evaluates every open window of a shop, extending or closing it. */
export async function runRescuePlans(shopId) {
  const plans = await db().rescuePlan.findMany({
    where: { verdict: null, product: { shopId } },
    include: { product: { select: { shopifyCreatedAt: true } } },
  });
  if (plans.length === 0) return;
  const { today, hour } = await shopTime(shopId);
  // Before the catch-up has run, yesterday may still be incomplete: count only up to the day before.
  const asOf = hour >= CLOSE_AFTER_HOUR ? today : dateKey(new Date(asDate(today).getTime() - DAY_MS));
  const orders = await db().syncState.findUnique({ where: { shopId_resource: { shopId, resource: "orders" } } });
  const ordersFrom =
    orders?.status === "done" && isLocalDate(orders.lastCursor) ? orders.lastCursor : dateKey(new Date(asDate(today).getTime() - ORDER_DAYS * DAY_MS));

  const earliest = new Date(Math.min(...plans.map((p) => p.startedAt.getTime())) - 3 * WINDOW.maxDays * DAY_MS);
  const storeRows = await db().productDailyMetric.groupBy({
    by: ["date"],
    where: { product: { shopId }, date: { gte: earliest } },
    _sum: { units: true, viewSessions: true },
  });
  const store = storeRows.map((r) => ({ date: dateKey(r.date), units: r._sum.units ?? 0, views: r._sum.viewSessions ?? 0 }));

  for (const plan of plans) {
    const state = { extended: false, baselineEnd: dateKey(plan.startedAt), ...((plan.baseline ?? {})) };
    const rows = await db().productDailyMetric.findMany({
      where: { productId: plan.productId, date: { gte: new Date(asDate(state.baselineEnd).getTime() - 2 * WINDOW.maxDays * DAY_MS) } },
      select: { date: true, units: true, viewSessions: true, purchaseSessions: true },
    });
    const product = rows.map((r) => ({ date: dateKey(r.date), units: r.units, views: r.viewSessions, purchases: r.purchaseSessions }));
    // Days before the product existed aren't "no sales".
    const created = plan.product.shopifyCreatedAt ? dateKey(plan.product.shopifyCreatedAt) : null;
    const historyFrom = created && created > ordersFrom ? created : ordersFrom;
    const result = evaluateWindow({
      start: dateKey(plan.startedAt),
      today: asOf,
      product,
      store,
      extended: state.extended,
      historyFrom,
      baselineEnd: state.baselineEnd,
    });

    // Guarded: a fix restarting this plan meanwhile (new startedAt) wins over this evaluation.
    const where = { id: plan.id, verdict: null, startedAt: plan.startedAt };
    if (result.status === "extend") {
      await db().rescuePlan.updateMany({
        where,
        data: { baseline: { ...state, extended: true }, endsAt: new Date(plan.startedAt.getTime() + 2 * WINDOW.maxDays * DAY_MS) },
      });
    } else if (result.status === "done") {
      await db().rescuePlan.updateMany({
        where,
        data: { verdict: result.verdict, result, endsAt: new Date(asDate(result.window.to).getTime() + DAY_MS) },
      });
    }
  }
}
