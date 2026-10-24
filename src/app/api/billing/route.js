import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { changePlan, PlanError, syncPlan } from "@/lib/billing";
import { env } from "@/lib/env";
import { getPlan, PLANS, remainingTrialDays } from "@/lib/plans";

function handleError(error) {
  if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
  if (error instanceof PlanError) return new Response(error.message, { status: 409 });
  throw error;
}

// Current plan (synced from Shopify) and the plan list.
export async function GET(request) {
  try {
    const { session } = await authenticate(request);
    const current = await syncPlan(session);
    const shop = await db().shop.findUnique({ where: { domain: session.shop } });
    return Response.json({
      current,
      trialDays: remainingTrialDays(shop?.trialStartedAt ?? null),
      plans: PLANS.map((p) => ({ ...p, products: Number.isFinite(p.products) ? p.products : null })),
    });
  } catch (error) {
    return handleError(error);
  }
}

// Body: { plan: PlanId }. Returns { confirmationUrl } for paid plans, null for Free.
export async function POST(request) {
  try {
    const { session } = await authenticate(request);

    let plan;
    try {
      plan = ((await request.json()))?.plan;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (typeof plan !== "string" || !getPlan(plan)) return new Response("Unknown plan", { status: 400 });

    // Back to the plans page inside Shopify Admin after the merchant approves.
    const returnUrl = `https://${session.shop}/admin/apps/${env.shopifyApiKey}/plans`;
    return Response.json(await changePlan(session, plan, returnUrl));
  } catch (error) {
    return handleError(error);
  }
}
