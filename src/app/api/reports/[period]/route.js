import { authenticate, AuthError } from "@/lib/auth";
import { featureGate } from "@/lib/feature-gate";
import { monthRange } from "@/lib/report";
import { buildReport } from "@/lib/reports";

// One month's report, built from current data (so late verdicts and fix effects are always included).
export async function GET(request, ctx) {
  try {
    const { shop } = await authenticate(request);
    const blocked = featureGate(shop, "reports");
    if (blocked) return blocked;
    const { period } = await ctx.params;
    if (!monthRange(period)) return Response.json({ error: "Month must be YYYY-MM" }, { status: 400 });
    return Response.json(await buildReport(shop.id, period));
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
