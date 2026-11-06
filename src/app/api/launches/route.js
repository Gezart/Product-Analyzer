import { listLaunches } from "@/lib/launches-shop";
import { appRoute } from "@/lib/route";

// New products in their first 30 days, against the store (every plan).
export const GET = appRoute(async ({ shop }) => {
  const data = await listLaunches(shop);
  return Response.json({ ...data, currency: shop.currency });
});
