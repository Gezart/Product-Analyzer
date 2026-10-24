import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { localDateKey } from "@/lib/jobs/schedule";

// Months with a report: this month so far (built when opened) and every stored month, newest first.
export async function GET(request) {
  try {
    const { shop } = await authenticate(request);
    const stored = await db().report.findMany({
      where: { shopId: shop.id },
      orderBy: { period: "desc" },
      select: { period: true, revenueRecovered: true, stockValueCleared: true, productsRescued: true },
    });
    const current = localDateKey(new Date(), shop.timezone).slice(0, 7);
    return Response.json({
      currency: shop.currency,
      current,
      months: [
        { period: current, live: true },
        ...stored
          .filter((r) => r.period !== current)
          .map((r) => ({
            period: r.period,
            revenueRecovered: Number(r.revenueRecovered),
            stockValueCleared: Number(r.stockValueCleared),
            productsRescued: r.productsRescued,
          })),
      ],
    });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
