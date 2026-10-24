import { db } from "@/lib/db";
import { billingIsTest } from "@/lib/env";
import { PAID_PLANS, getPlan, planFromSubscriptions, remainingTrialDays } from "@/lib/plans";
import { shopify } from "@/lib/shopify";

const paidNames = PAID_PLANS.map((p) => p.name);

export class PlanError extends Error {}

async function activeSubscriptions(session) {
  const result = await shopify().billing.check({
    session,
    plans: paidNames,
    isTest: billingIsTest,
    returnObject: true,
  });
  return result.appSubscriptions.filter((s) => s.status === "ACTIVE");
}

/** Reads the active subscription from Shopify and stores the plan (and first trial start) on the shop. */
export async function syncPlan(session) {
  const subs = await activeSubscriptions(session);
  const plan = planFromSubscriptions(subs.map((s) => s.name));
  await db().shop.updateMany({ where: { domain: session.shop }, data: { plan } });
  if (subs[0]) {
    await db().shop.updateMany({
      where: { domain: session.shop, trialStartedAt: null },
      data: { trialStartedAt: new Date(subs[0].createdAt) },
    });
  }
  return plan;
}

/**
 * Starts a plan change. Paid plans return Shopify's confirmation URL;
 * Free cancels the active subscription right away.
 */
export async function changePlan(session, planId, returnUrl) {
  const plan = getPlan(planId);
  if (!plan) throw new PlanError(`Unknown plan ${planId}`);

  const subs = await activeSubscriptions(session);
  if (planFromSubscriptions(subs.map((s) => s.name)) === planId) {
    throw new PlanError(`Already on ${plan.name}`);
  }

  if (plan.price === 0) {
    for (const sub of subs) {
      await shopify().billing.cancel({ session, subscriptionId: sub.id, prorate: true, isTest: billingIsTest });
    }
    await db().shop.updateMany({ where: { domain: session.shop }, data: { plan: "free" } });
    return { confirmationUrl: null };
  }

  const shop = await db().shop.findUnique({ where: { domain: session.shop } });
  const { confirmationUrl } = await shopify().billing.request({
    session,
    plan: plan.name,
    isTest: billingIsTest,
    returnUrl,
    returnObject: true,
    trialDays: remainingTrialDays(shop?.trialStartedAt ?? null),
  });
  return { confirmationUrl };
}
