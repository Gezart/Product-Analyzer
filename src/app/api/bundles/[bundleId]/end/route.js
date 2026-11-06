import { endBundle } from "@/lib/bundles-shopify";
import { appRoute } from "@/lib/route";

// Ends a running bundle: the Shopify discount stops and the offer leaves the partner's page.
export const POST = appRoute(async ({ shop, params }) => {
  const { cleared, endsAt } = await endBundle(shop, params.bundleId);
  return Response.json({ ok: true, cleared, endsAt });
});
