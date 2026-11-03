// Actions on rising stars and their effect (units a day since, against the 30 days before).

import { asDate, DAY_MS } from "@/lib/dates";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { localDateKey } from "@/lib/jobs/schedule";
import { ACTION_LABELS, actionEffect, EFFECT_DAYS } from "@/lib/rising";

const dayKey = (d) => d.toISOString().slice(0, 10);

/**
 * Records an action on a rising star (`kind`: collections | home | stock), measured from today in the
 * store's calendar. The same action isn't recorded again while it's still measured (409; with `quiet`
 * the existing one is returned). `reorderId`: recorded by a saved collection order (undone with it).
 */
export async function recordRisingAction(shop, productId, kind, { quiet = false, reorderId = null } = {}) {
  if (typeof kind !== "string" || !Object.hasOwn(ACTION_LABELS, kind)) throw new HttpError("Unknown action.", 400);
  const product = await db().product.findFirst({ where: { id: productId, shopId: shop.id }, select: { id: true } });
  if (!product) throw new HttpError("Product not found.", 404);
  if (!quiet) {
    const score = await db().productScore.findFirst({ where: { productId }, orderBy: { computedAt: "desc" }, select: { rising: true } });
    if (!score?.rising) throw new HttpError("This product isn't a rising star right now.", 409);
  }
  const today = asDate(localDateKey(new Date(), shop.timezone));
  const openOne = () => db().risingAction.findFirst({ where: { productId, kind, startedOn: { gt: new Date(today.getTime() - EFFECT_DAYS * DAY_MS) } } });
  const busy = (open) => {
    if (quiet) return open;
    throw new HttpError(`Already measured since ${dayKey(open.startedOn)}.`, 409);
  };
  const open = await openOne();
  if (open) return busy(open);
  try {
    return await db().risingAction.create({ data: { productId, kind, startedOn: today, reorderId } });
  } catch (error) {
    // Two at once on the same day: the database keeps one (unique product, kind and day).
    if (error?.code === "P2002") return busy(await openOne());
    throw error;
  }
}

/** A saved collection order was undone: the actions it recorded go too. */
export async function removeReorderActions(reorderId) {
  await db().risingAction.deleteMany({ where: { reorderId } });
}

/** A product's actions of the last 90 days with their effect so far, newest first. */
export async function risingEffects(shop, productId) {
  const today = localDateKey(new Date(), shop.timezone);
  const actions = await db().risingAction.findMany({
    where: { productId, startedOn: { gte: new Date(asDate(today).getTime() - 90 * DAY_MS) } },
    orderBy: { startedOn: "desc" },
  });
  if (!actions.length) return [];
  const earliest = Math.min(...actions.map((a) => a.startedOn.getTime()));
  const rows = await db().productDailyMetric.findMany({
    where: { productId, date: { gte: new Date(earliest - EFFECT_DAYS * DAY_MS) } },
    select: { date: true, units: true },
  });
  const days = rows.map((r) => ({ date: dayKey(r.date), units: r.units }));
  return actions.map((a) => ({ id: a.id, kind: a.kind, label: ACTION_LABELS[a.kind], startedOn: dayKey(a.startedOn), ...actionEffect(days, dayKey(a.startedOn), today) }));
}
