// Monthly AI uses per shop (the plan's limit) and what they cost, in `ai_usage` (one row per shop and month).

import { db } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { localDateKey } from "@/lib/jobs/schedule";
import { getPlan, PLANS } from "@/lib/plans";

/** The store's month, "YYYY-MM": uses renew on the 1st in the store's timezone. */
const monthOf = (shop) => localDateKey(new Date(), shop.timezone).slice(0, 7);

/** AI descriptions a plan includes per month. */
export const aiTextLimit = (planId) => (getPlan(planId) ?? PLANS[0]).aiTexts ?? 0;

/** This month's AI descriptions: used, the plan's limit, and how many are left. */
export async function aiAllowance(shop) {
  const month = monthOf(shop);
  const row = await db().aiUsage.findUnique({ where: { shopId_month: { shopId: shop.id, month } }, select: { calls: true } });
  const limit = aiTextLimit(shop.plan);
  const used = row?.calls ?? 0;
  return { month, used, limit, left: Math.max(0, limit - used) };
}

/** The next plan with more AI descriptions, for the "upgrade" link. */
function morePlan(planId) {
  const current = aiTextLimit(planId);
  return PLANS.find((p) => (p.aiTexts ?? 0) > current)?.id ?? null;
}

/**
 * Takes one of this month's AI descriptions before calling the AI, atomically (two requests at once
 * can't both take the last one). Throws 429 when they're used up. Returns the month to give it back to.
 */
export async function reserveAiText(shop) {
  const month = monthOf(shop);
  const limit = aiTextLimit(shop.plan);
  await db().$executeRaw`INSERT INTO "ai_usage" ("shop_id", "month") VALUES (${shop.id}, ${month}) ON CONFLICT DO NOTHING`;
  const taken = await db().$executeRaw`
    UPDATE "ai_usage" SET "calls" = "calls" + 1 WHERE "shop_id" = ${shop.id} AND "month" = ${month} AND "calls" < ${limit}`;
  if (taken === 0) {
    const upgrade = morePlan(shop.plan);
    throw new HttpError(`This month's ${limit} AI descriptions are used up. They renew on the 1st${upgrade ? ", or upgrade for more" : ""}.`, 429, upgrade ? { upgrade } : {});
  }
  return month;
}

/** Gives a use back when the AI couldn't deliver a draft. */
export async function releaseAiText(shop, month) {
  await db().$executeRaw`UPDATE "ai_usage" SET "calls" = "calls" - 1 WHERE "shop_id" = ${shop.id} AND "month" = ${month} AND "calls" > 0`;
}

/** Adds a request's tokens and cost to the month (also for failed drafts: the tokens were spent). */
export async function recordAiCost(shop, month, { inputTokens, outputTokens, costUsd }) {
  await db().$executeRaw`
    UPDATE "ai_usage" SET "input_tokens" = "input_tokens" + ${inputTokens}, "output_tokens" = "output_tokens" + ${outputTokens},
      "cost_usd" = "cost_usd" + ${costUsd}
    WHERE "shop_id" = ${shop.id} AND "month" = ${month}`;
}
