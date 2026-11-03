// Weekly plan: built each Monday (store time) from the latest scores, diagnoses, rescue plans and
// markdowns, and sent to the inbox. The plan is kept in the notification, as it was on Monday.

import { summarize } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { REASON_TITLES } from "@/lib/diagnosis-titles";
import { localDateKey } from "@/lib/jobs/schedule";
import { markdownEligibility } from "@/lib/markdown-engine";
import { notify } from "@/lib/notify";
import { latestScores } from "@/lib/scores";
import { asDate, DAY_MS } from "@/lib/dates";
import { lastWeekOf, pickActions, recapOf, verdictCounts, weekOf } from "@/lib/weekly-plan";

/** Candidates looked at: the dashboard's action list, a bit longer (some drop out as already handled). */
const CANDIDATES = 15;

/** This week's actions for a shop (see `pickActions`). */
export async function buildWeeklyPlan(shopId) {
  // Products already handled (being measured, on a markdown) leave first, so they don't take places.
  const [scores, open, running] = await Promise.all([
    latestScores(shopId),
    db().rescuePlan.findMany({ where: { product: { shopId }, verdict: null }, select: { productId: true } }),
    db().markdownPlan.findMany({ where: { product: { shopId }, status: { in: ["active", "paused"] } }, select: { productId: true } }),
  ]);
  const measuring = new Set(open.map((r) => r.productId));
  const onMarkdown = new Set(running.map((r) => r.productId));
  const { top } = summarize(scores.filter((r) => !measuring.has(r.productId) && !onMarkdown.has(r.productId)), CANDIDATES);
  if (!top.length) return [];
  const ids = top.map((r) => r.productId);
  const [diagnoses, products] = await Promise.all([
    db().diagnosis.findMany({ where: { productId: { in: ids } }, orderBy: { createdAt: "desc" }, distinct: ["productId"], select: { productId: true, reasons: true } }),
    db().product.findMany({ where: { id: { in: ids } }, include: { shop: true } }),
  ]);
  const reasonOf = new Map(diagnoses.map((d) => [d.productId, d.reasons?.[0] ?? null]));
  const diagnosed = new Set(diagnoses.map((d) => d.productId));
  const byId = new Map(products.map((p) => [p.id, p]));
  const candidates = [];
  for (const r of top) {
    const product = byId.get(r.productId);
    // A markdown is checked only where it could be the action.
    const markdown = product && r.status !== "stockout_risk" ? await markdownEligibility(product).catch(() => null) : null;
    const reason = reasonOf.get(r.productId);
    candidates.push({
      productId: r.productId,
      title: r.title,
      status: r.status,
      moneyAtStake: r.moneyAtStake,
      daysOfCover: r.daysOfCover,
      markdownReason: markdown?.reason ?? null,
      diagnosed: diagnosed.has(r.productId),
      topReason: reason ? { code: reason.code, label: REASON_TITLES[reason.code] ?? reason.code, link: reason.link ?? null } : null,
      measuring: false,
      markdownRunning: false,
    });
  }
  return pickActions(candidates);
}

/** Verdicts are looked for this far back, so one decided late (after its week's plan) still comes once. */
const LATE_VERDICT_DAYS = 21;

/**
 * Last week's results for a plan's week (see `recapOf`):
 * - rescue verdicts whose window ended last week, or earlier but not yet in a plan (decided late);
 * - markdowns that went live (step 1 applied) or ended last week, by the store's calendar.
 */
export async function lastWeekRecap(shopId, week) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { timezone: true } });
  const timezone = shop?.timezone ?? "UTC";
  const { from, to } = lastWeekOf(week);
  const start = asDate(from);
  const end = new Date(asDate(to).getTime() + DAY_MS);
  const earliest = shiftKey(from, -LATE_VERDICT_DAYS);
  const [plans, started, ended, earlier] = await Promise.all([
    // A window runs at most 60 days: older plans can't have ended in the time looked at.
    db().rescuePlan.findMany({
      where: { product: { shopId }, verdict: { in: ["improved", "no_change", "worse", "not_enough_data"] }, startedAt: { gte: new Date(asDate(earliest).getTime() - 70 * DAY_MS) } },
      select: { productId: true, verdict: true, result: true, product: { select: { title: true, price: true } } },
    }),
    // Plans start at the store's midnight (a local date); only ones that went live count.
    db().markdownPlan.findMany({ where: { product: { shopId }, startedAt: { gte: start, lt: end }, currentStep: { gte: 0 } }, select: { id: true, productId: true, product: { select: { title: true } } } }),
    // `endedAt` is a moment: a day either side, then each one's day in the store's calendar.
    db().markdownPlan.findMany({
      where: { product: { shopId }, endedAt: { gte: new Date(start.getTime() - DAY_MS), lt: new Date(end.getTime() + DAY_MS) }, currentStep: { gte: 0 }, status: { not: "failed" } },
      select: { id: true, productId: true, endReason: true, endedAt: true, product: { select: { title: true } } },
    }),
    // Verdicts the earlier plans already reported.
    db().notification.findMany({ where: { shopId, type: "weekly_plan" }, orderBy: { createdAt: "desc" }, take: 4, select: { data: true } }),
  ]);
  const reported = new Set(earlier.flatMap((n) => (n.data?.week !== week ? (n.data?.lastWeek?.verdicts ?? []).map((v) => `${v.productId}:${v.windowTo}`) : [])));
  const inWeek = (key) => key >= from && key <= to;
  // Last week's verdicts, and earlier ones no plan has reported yet (decided after their week's plan).
  return recapOf({
    verdicts: plans
      .filter((p) => verdictCounts(p.productId, p.result?.window?.to, { from, to, earliest, reported }))
      .map((p) => ({ productId: p.productId, title: p.product.title, price: Number(p.product.price), verdict: p.verdict, result: p.result })),
    started: started.map((m) => ({ id: m.id, productId: m.productId, title: m.product.title })),
    ended: ended.filter((m) => inWeek(localDateKey(m.endedAt, timezone))).map((m) => ({ id: m.id, productId: m.productId, title: m.product.title, endReason: m.endReason })),
  });
}

const shiftKey = (key, days) => new Date(asDate(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Job "weekly-plan" (nightly; acts on Mondays in the store's timezone): this week's plan, with last
 * week's results, in the inbox, once per week, when there's something to do or to report.
 */
export async function sendWeeklyPlan(shopId, now = new Date()) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { timezone: true, currency: true, uninstalledAt: true } });
  if (!shop || shop.uninstalledAt) return;
  const today = localDateKey(now, shop.timezone);
  if (weekOf(today) !== today) return; // not Monday
  const sent = await db().notification.findFirst({ where: { shopId, type: "weekly_plan", data: { path: ["week"], equals: today } }, select: { id: true } });
  if (sent) return;
  const [actions, lastWeek] = await Promise.all([buildWeeklyPlan(shopId), lastWeekRecap(shopId, today)]);
  if (!actions.length && !lastWeek) return;
  await notify({ shopId, type: "weekly_plan", data: { week: today, actions, lastWeek, currency: shop.currency } });
}

/** A week's plan (`week`: its Monday), or the latest one; with the weeks there are plans for. */
export async function weeklyPlan(shopId, week) {
  const plans = await db().notification.findMany({ where: { shopId, type: "weekly_plan" }, orderBy: { createdAt: "desc" }, take: 12, select: { data: true } });
  const weeks = plans.map((p) => p.data?.week).filter(Boolean);
  const plan = (week ? plans.find((p) => p.data?.week === week) : plans[0])?.data ?? null;
  return { plan, weeks };
}
