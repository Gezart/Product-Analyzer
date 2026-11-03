// Return rates from stored orders and refunds: a product's and the store's, over the same recent days.

import { DAY_MS } from "@/lib/dates";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { orderWindowStart } from "@/lib/sync/initial-sync";

/** Return rates look back this far (or to the start of the known order history, if later). */
export const RETURN_DAYS = 90;

/** The first day counted and how many days that is, in the store's calendar. */
export async function returnWindow(shopId, timeZone) {
  const today = localDateKey(new Date(), timeZone);
  const back = localDateKey(new Date(Date.parse(`${today}T12:00:00Z`) - RETURN_DAYS * DAY_MS), "UTC");
  const start = await orderWindowStart(shopId, timeZone);
  const from = start > back ? start : back;
  return { from, days: Math.max(1, Math.round((Date.parse(today) - Date.parse(from)) / DAY_MS)) };
}

/**
 * Units that came back out of units sold (kept + returned), since `from`; for one product
 * (`productGid`) or the whole store. `rate` is null when nothing sold.
 */
export async function returnRate(shopId, from, productGid = null) {
  const since = new Date(`${from}T00:00:00Z`);
  const where = { shopId, date: { gte: since }, ...(productGid ? { productGid } : {}) };
  const [kept, back] = await Promise.all([
    db().orderLine.aggregate({ where, _sum: { quantity: true } }),
    db().lineRefund.aggregate({ where, _sum: { returnedQty: true, refundedAmount: true } }),
  ]);
  const returned = back._sum.returnedQty ?? 0;
  const sold = (kept._sum.quantity ?? 0) + returned;
  return { sold, returned, refunded: Number(back._sum.refundedAmount ?? 0), rate: sold > 0 ? returned / sold : null };
}

/**
 * Why a product's items came back since `from`, most common first (ties by reason, so every caller
 * agrees): `[{ handle, name, count }]`. One reason can be stored under two names (Shopify's newer and
 * older wording): it's counted once, with its latest name.
 */
export async function topReturnReasons(shopId, from, productGid, limit = 3) {
  const where = { shopId, productGid, date: { gte: new Date(`${from}T00:00:00Z`) } };
  const rows = await db().returnReason.groupBy({
    by: ["reason"],
    where,
    _sum: { quantity: true },
    orderBy: [{ _sum: { quantity: "desc" } }, { reason: "asc" }],
    take: limit,
  });
  const names = await db().returnReason.findMany({
    where: { ...where, reason: { in: rows.map((r) => r.reason) } },
    distinct: ["reason"],
    orderBy: [{ reason: "asc" }, { orderUpdatedAt: "desc" }],
    select: { reason: true, reasonName: true },
  });
  const nameOf = new Map(names.map((n) => [n.reason, n.reasonName]));
  return rows.map((r) => ({ handle: r.reason, name: nameOf.get(r.reason) ?? r.reason, count: r._sum.quantity ?? 0 })).filter((r) => r.count > 0);
}
