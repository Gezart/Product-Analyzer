import { requireFeature } from "@/lib/feature-gate";
import { monthRange } from "@/lib/report";
import { buildReport } from "@/lib/reports";
import { appRoute } from "@/lib/route";

// One month's report, built from current data (so late verdicts and fix effects are always included).
export const GET = appRoute(async ({ shop, params }) => {
  requireFeature(shop, "reports");
  const { period } = params;
  if (!monthRange(period)) return Response.json({ error: "Month must be YYYY-MM" }, { status: 400 });
  return Response.json(await buildReport(shop.id, period));
});
