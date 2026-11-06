import { bundleLimit } from "@/lib/bundles-shopify";
import { requireFeature } from "@/lib/feature-gate";
import { appRoute } from "@/lib/route";

const GID = /^gid:\/\/shopify\/Product\/\d+$/;

// ?gid=<product GID>: the most that product can be discounted in a bundle (its margin floor), with why when none.
export const GET = appRoute(async ({ request, shop }) => {
  requireFeature(shop, "bundles");
  const gid = new URL(request.url).searchParams.get("gid") ?? "";
  if (!GID.test(gid)) return Response.json({ error: "Not a product" }, { status: 400 });
  return Response.json(await bundleLimit(shop, gid));
});
