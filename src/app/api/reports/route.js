import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";
import { monthsBetween, previousMonth } from "@/lib/report";

// Months with a report, newest first: from the install month to this month (once it has a complete day).
export async function GET(request) {
  try {
    const { shop } = await authenticate(request);
    const row = await db().shop.findUnique({ where: { id: shop.id }, select: { installedAt: true } });
    const today = localDateKey(new Date(), shop.timezone);
    const last = today.slice(8) === "01" ? previousMonth(today) : today.slice(0, 7);
    const first = row ? localDateKey(row.installedAt, shop.timezone).slice(0, 7) : last;
    return Response.json({ currency: shop.currency, current: today.slice(0, 7), months: monthsBetween(first < last ? first : last, last) });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
