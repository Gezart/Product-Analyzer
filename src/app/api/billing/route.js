import { changePlan, syncPlan } from "@/lib/billing";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getPlan, PLANS, remainingTrialDays } from "@/lib/plans";
import { appRoute } from "@/lib/route";

// Current plan (synced from Shopify) and the plan list.
export const GET = appRoute(async ({ session }) => {
  const current = await syncPlan(session);
  const shop = await db().shop.findUnique({ where: { domain: session.shop } });
  return Response.json({
    current,
    trialDays: remainingTrialDays(shop?.trialStartedAt ?? null),
    plans: PLANS.map((p) => ({ ...p, products: Number.isFinite(p.products) ? p.products : null })),
  });
});

// Body: { plan: PlanId }. Returns { confirmationUrl } for paid plans, null for Free.
export const POST = appRoute(async ({ request, session }) => {
  let plan;
  try {
    plan = (await request.json())?.plan;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof plan !== "string" || !getPlan(plan)) return Response.json({ error: "Unknown plan" }, { status: 400 });

  // Back to the plans page inside Shopify Admin after the merchant approves.
  const returnUrl = `https://${session.shop}/admin/apps/${env.shopifyApiKey}/plans`;
  return Response.json(await changePlan(session, plan, returnUrl));
});
