import { db } from "@/lib/db";
import { requireFeature } from "@/lib/feature-gate";
import { localDateKey } from "@/lib/jobs/schedule";
import { monthsBetween, previousMonth } from "@/lib/report";
import { appRoute } from "@/lib/route";

// Months with a report, newest first: from the install month to this month (once it has a complete day).
export const GET = appRoute(async ({ shop }) => {
  requireFeature(shop, "reports");
  const row = await db().shop.findUnique({ where: { id: shop.id }, select: { installedAt: true } });
  const today = localDateKey(new Date(), shop.timezone);
  const last = today.slice(8) === "01" ? previousMonth(today) : today.slice(0, 7);
  const first = row ? localDateKey(row.installedAt, shop.timezone).slice(0, 7) : last;
  // Installed on the 1st: no complete day yet, so no month to show until tomorrow.
  return Response.json({ currency: shop.currency, current: today.slice(0, 7), months: last < first ? [] : monthsBetween(first, last) });
});
