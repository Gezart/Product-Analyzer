// Launch tracker in the database: new products' daily numbers against the store, the checkpoints
// recorded every night (with an inbox note when a launch needs attention or starts strong), and the
// Launches page's list.

import { asDate, dateKey, shiftDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { daysSince, dueCheckpoint, judgeLaunch, launchWindow, NOTIFY, RULES, storeBenchmarks } from "@/lib/launches";
import { notify } from "@/lib/notify";

/** Products the plan doesn't analyze, or the merchant left out, aren't followed. */
const LEFT_OUT = ["over_limit", "excluded"];

/** Active products created in the last `days` days (store dates), with their recorded checkpoints. */
async function newProducts(shop, today, days) {
  const since = shiftDate(today, -days);
  const products = await db().product.findMany({
    // A day's margin for time zones; the store date decides below.
    where: { shopId: shop.id, status: "ACTIVE", shopifyCreatedAt: { gte: asDate(shiftDate(since, -1)) } },
    select: {
      id: true,
      title: true,
      shopifyCreatedAt: true,
      launchChecks: { select: { day: true, status: true, data: true }, orderBy: { day: "asc" } },
      scores: { orderBy: { computedAt: "desc" }, take: 1, select: { status: true } },
    },
  });
  return products
    .map((p) => ({ ...p, createdOn: localDateKey(p.shopifyCreatedAt, shop.timezone) }))
    .filter((p) => p.createdOn >= since && p.createdOn <= today && !LEFT_OUT.includes(p.scores[0]?.status));
}

/** The store's yardsticks from every active product's last 30 days (before today). */
async function benchmarks(shopId, today) {
  const rows = await db().$queryRaw`
    SELECT SUM(m."view_sessions")::int AS "views", SUM(m."cart_sessions")::int AS "carts"
    FROM "product_daily_metrics" m JOIN "products" p ON p."id" = m."product_id"
    WHERE p."shop_id" = ${shopId} AND p."status" = 'ACTIVE' AND m."date" >= ${asDate(shiftDate(today, -30))} AND m."date" < ${asDate(today)}
    GROUP BY m."product_id"`;
  return storeBenchmarks(rows);
}

/** Daily rows per product id, from `from` on (dates as "YYYY-MM-DD"). */
async function dailyRows(ids, from) {
  const rows = await db().productDailyMetric.findMany({ where: { productId: { in: ids }, date: { gte: asDate(from) } } });
  const out = new Map();
  for (const r of rows) out.set(r.productId, [...(out.get(r.productId) ?? []), { ...r, date: dateKey(r.date) }]);
  return out;
}

/**
 * Nightly: records the checkpoint each new product reached (day 7, 14 or 30), judged against the store,
 * and tells the inbox about launches that need attention or start strong. Each checkpoint is recorded
 * once, so a repeated run changes nothing.
 */
export async function runLaunchTracker(shopId, now = new Date()) {
  const shop = await db().shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.uninstalledAt) return;
  const today = localDateKey(now, shop.timezone);
  const products = await newProducts(shop, today, RULES.days + 1);
  const due = products
    .map((p) => ({ product: p, day: dueCheckpoint(p.createdOn, today, p.launchChecks.map((c) => c.day)) }))
    .filter((d) => d.day != null);
  if (!due.length) return;
  const from = due.map((d) => d.product.createdOn).sort()[0];
  const [store, rows] = await Promise.all([benchmarks(shop.id, today), dailyRows(due.map((d) => d.product.id), from)]);

  for (const { product, day } of due) {
    const window = launchWindow(rows.get(product.id) ?? [], product.createdOn, day, today);
    const verdict = judgeLaunch(window, store);
    try {
      await db().launchCheck.create({
        data: { productId: product.id, day, status: verdict.status, data: { ...window, storeCartRate: store.cartRate, reason: verdict.reason } },
      });
    } catch (error) {
      if (error?.code === "P2002") continue; // recorded by a run at the same time
      throw error;
    }
    if (NOTIFY.includes(verdict.status)) {
      await notify({ shopId, type: "launch_check", productId: product.id, data: { day, status: verdict.status, reason: verdict.reason } });
    }
  }
}

const ORDER = ["page_problem", "no_traffic", "not_enough_data", "on_track", "strong"];

/**
 * The Launches page: products created in the last 30 days with their numbers so far, how they're doing
 * against the store now, and the checkpoints recorded. Launches that need attention first, then newest.
 */
export async function listLaunches(shop, now = new Date()) {
  const today = localDateKey(now, shop.timezone);
  const products = await newProducts(shop, today, RULES.days);
  const store = await benchmarks(shop.id, today);
  if (!products.length) return { launches: [], store, rules: RULES };
  const from = products.map((p) => p.createdOn).sort()[0];
  const rows = await dailyRows(products.map((p) => p.id), from);

  const launches = products.map((p) => {
    const age = daysSince(p.createdOn, today);
    const window = launchWindow(rows.get(p.id) ?? [], p.createdOn, Math.min(age, RULES.days), today);
    const now = age < 1 ? { status: "not_enough_data", reason: "Launched today; its numbers come in tomorrow." } : judgeLaunch(window, store);
    return {
      id: p.id,
      title: p.title,
      createdOn: p.createdOn,
      day: age,
      ...window,
      ...now,
      checks: p.launchChecks.map((c) => ({ day: c.day, status: c.status, reason: c.data?.reason ?? null })),
    };
  });
  launches.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.createdOn.localeCompare(a.createdOn) || a.id.localeCompare(b.id));
  return { launches, store, rules: RULES };
}
