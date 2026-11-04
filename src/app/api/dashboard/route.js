import { asDate, DAY_MS } from "@/lib/dates";
import { summarize } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { appRoute } from "@/lib/route";
import { latestScores } from "@/lib/scores";
import { weekOf } from "@/lib/weekly-plan";
import { weeklyPlan } from "@/lib/weekly-plans";

/** Running out: stock-out risks, fewest days of stock first (the dashboard shows 3). */
const RUNNING_OUT = 3;

// Catalog health from each product's latest score, with what the dashboard shows beside it: this week's
// first moves, the next best move's facts, the rising stars' conversion and what runs out first.
export const GET = appRoute(async ({ shop }) => {
  const scores = await latestScores(shop.id);
  const scoredAt = scores.reduce((max, r) => (!max || r.computedAt > max ? r.computedAt : max), null);
  // Scoring writes a row for every product that isn't deleted, so with no scores the analysis is only
  // "done" when the import finished and there is no such product (an empty store).
  const imported =
    scoredAt != null ||
    ((await db().syncState.findUnique({ where: { shopId_resource: { shopId: shop.id, resource: "orders" } } }))?.status === "done" &&
      (await db().product.count({ where: { shopId: shop.id, status: { not: "DELETED" } } })) === 0);
  const summary = summarize(scores);
  const first = summary.top[0];
  const rising = summary.rising.top.slice(0, 3);
  const dayKey = localDateKey(new Date(), shop.timezone);
  const today = asDate(dayKey);
  const [plan, firstProduct, lastSale, risingSums] = await Promise.all([
    weeklyPlan(shop.id),
    first ? db().product.findUnique({ where: { id: first.productId }, select: { imageCount: true } }) : null,
    first ? db().productDailyMetric.findFirst({ where: { productId: first.productId, units: { gt: 0 } }, orderBy: { date: "desc" }, select: { date: true } }) : null,
    rising.length
      ? db().productDailyMetric.groupBy({
          by: ["productId"],
          where: { productId: { in: rising.map((r) => r.productId) }, date: { gte: new Date(today.getTime() - 30 * DAY_MS), lt: today } },
          _sum: { viewSessions: true, purchaseSessions: true },
        })
      : [],
  ]);
  const conversion = new Map(risingSums.map((r) => [r.productId, r._sum.viewSessions > 0 ? r._sum.purchaseSessions / r._sum.viewSessions : null]));
  return Response.json({
    currency: shop.currency,
    plan: shop.plan,
    scoredAt,
    imported,
    ...summary,
    rising: { ...summary.rising, top: rising.map((r) => ({ ...r, conversion: conversion.get(r.productId) ?? null })) },
    // This week's plan (kept as it was on Monday): its first three moves; an older week's isn't "this week".
    week: plan.plan && plan.plan.week === weekOf(dayKey) ? { week: plan.plan.week, actions: (plan.plan.actions ?? []).slice(0, 3) } : null,
    nextMove: first
      ? {
          imageCount: firstProduct?.imageCount ?? null,
          daysSinceSale: lastSale ? Math.round((today.getTime() - lastSale.date.getTime()) / DAY_MS) : null,
        }
      : null,
    runningOut: scores
      .filter((r) => r.status === "stockout_risk")
      .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0))
      .slice(0, RUNNING_OUT)
      .map((r) => ({ productId: r.productId, title: r.title, daysOfCover: r.daysOfCover })),
    runningOutCount: scores.filter((r) => r.status === "stockout_risk").length,
  });
});
