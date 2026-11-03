// Monthly AI uses per shop (the plan's limits) and what they cost, in `ai_usage` (one row per shop and
// month). Two kinds, each with its own limit: "texts" (descriptions) and "photos".

import { db } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { localDateKey } from "@/lib/jobs/schedule";
import { aiLimit, aiUpgradePlan } from "@/lib/plans";

/** The store's month, "YYYY-MM": uses renew on the 1st in the store's timezone. */
const monthOf = (shop) => localDateKey(new Date(), shop.timezone).slice(0, 7);

const NAMES = { texts: "AI descriptions", photos: "AI photos" };

/** This month's uses of a kind: used, the plan's limit, and how many are left. */
export async function aiAllowance(shop, kind = "texts") {
  const month = monthOf(shop);
  const row = await db().aiUsage.findUnique({ where: { shopId_month: { shopId: shop.id, month } }, select: { calls: true, photoCalls: true } });
  const limit = aiLimit(shop.plan, kind);
  const used = (kind === "photos" ? row?.photoCalls : row?.calls) ?? 0;
  return { month, used, limit, left: Math.max(0, limit - used) };
}

/** Takes one use if one is left; the number of rows changed (0 when used up). */
function take(shop, month, kind, limit) {
  return kind === "photos"
    ? db().$executeRaw`UPDATE "ai_usage" SET "photo_calls" = "photo_calls" + 1 WHERE "shop_id" = ${shop.id} AND "month" = ${month} AND "photo_calls" < ${limit}`
    : db().$executeRaw`UPDATE "ai_usage" SET "calls" = "calls" + 1 WHERE "shop_id" = ${shop.id} AND "month" = ${month} AND "calls" < ${limit}`;
}

/**
 * Takes one of this month's uses before calling the AI, atomically (two requests at once can't both
 * take the last one). Throws 429 when they're used up. Returns the month to give it back to.
 */
export async function reserveAi(shop, kind = "texts") {
  const month = monthOf(shop);
  const limit = aiLimit(shop.plan, kind);
  await db().$executeRaw`INSERT INTO "ai_usage" ("shop_id", "month") VALUES (${shop.id}, ${month}) ON CONFLICT DO NOTHING`;
  if ((await take(shop, month, kind, limit)) === 0) {
    const upgrade = aiUpgradePlan(shop.plan, kind);
    throw new HttpError(`This month's ${limit} ${NAMES[kind]} are used up. They renew on the 1st${upgrade ? ", or upgrade for more" : ""}.`, 429, upgrade ? { upgrade } : {});
  }
  return month;
}

/** Gives a use back when the AI couldn't deliver. */
export async function releaseAi(shop, month, kind = "texts") {
  if (kind === "photos") {
    await db().$executeRaw`UPDATE "ai_usage" SET "photo_calls" = "photo_calls" - 1 WHERE "shop_id" = ${shop.id} AND "month" = ${month} AND "photo_calls" > 0`;
  } else {
    await db().$executeRaw`UPDATE "ai_usage" SET "calls" = "calls" - 1 WHERE "shop_id" = ${shop.id} AND "month" = ${month} AND "calls" > 0`;
  }
}

/** Adds a description request's tokens and cost to the month (also for failed drafts: the tokens were spent). */
export async function recordAiCost(shop, month, { inputTokens, outputTokens, costUsd }) {
  await db().$executeRaw`
    UPDATE "ai_usage" SET "input_tokens" = "input_tokens" + ${inputTokens}, "output_tokens" = "output_tokens" + ${outputTokens},
      "cost_usd" = "cost_usd" + ${costUsd}
    WHERE "shop_id" = ${shop.id} AND "month" = ${month}`;
}

/** Adds a photo request's cost to the month. */
export async function recordPhotoCost(shop, month, costUsd) {
  await db().$executeRaw`UPDATE "ai_usage" SET "photo_cost_usd" = "photo_cost_usd" + ${costUsd} WHERE "shop_id" = ${shop.id} AND "month" = ${month}`;
}
