import { appRoute } from "@/lib/route";
import { weeklyPlan } from "@/lib/weekly-plans";

// A week's plan (`?week=YYYY-MM-DD`, its Monday) or the latest, and the weeks there are plans for.
export const GET = appRoute(async ({ request, shop }) => {
  const week = new URL(request.url).searchParams.get("week");
  return Response.json({ ...(await weeklyPlan(shop.id, /^\d{4}-\d{2}-\d{2}$/.test(week ?? "") ? week : null)), currency: shop.currency });
});
