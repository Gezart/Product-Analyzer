import { appRoute } from "@/lib/route";

export const GET = appRoute(async ({ shop }) => {
  return Response.json({ domain: shop.domain, plan: shop.plan, installedAt: shop.installedAt });
});
