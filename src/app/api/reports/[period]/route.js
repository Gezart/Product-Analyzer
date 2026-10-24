import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { monthRange } from "@/lib/report";
import { buildReport } from "@/lib/reports";

// One month's report: the stored one for a finished month, built now for this month (or a month not stored yet).
export async function GET(request, ctx) {
  try {
    const { shop } = await authenticate(request);
    const { period } = await ctx.params;
    if (!monthRange(period)) return Response.json({ error: "Month must be YYYY-MM" }, { status: 400 });
    const stored = await db().report.findUnique({ where: { shopId_period: { shopId: shop.id, period } } });
    return Response.json(stored ? { ...stored.payload, stored: true } : { ...(await buildReport(shop.id, period)), stored: false });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
