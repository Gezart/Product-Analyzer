import { productForTest } from "@/lib/ab-tests-shopify";
import { db } from "@/lib/db";
import { appRoute } from "@/lib/route";

const GID = /^gid:\/\/shopify\/Product\/\d+$/;

// ?gid=<Shopify product GID> (from the product picker) or ?id=<the app's product id>: the product's
// title, description and photos as they are now, for a new test.
export const GET = appRoute(async ({ request, shop }) => {
  const params = new URL(request.url).searchParams;
  const gid = params.get("gid");
  let productId = params.get("id");
  if (gid) {
    if (!GID.test(gid)) return Response.json({ error: "Not a product" }, { status: 400 });
    const product = await db().product.findFirst({ where: { shopId: shop.id, shopifyGid: gid }, select: { id: true } });
    if (!product) return Response.json({ error: "This product isn't in the app yet. New products are imported within minutes; try again soon." }, { status: 404 });
    productId = product.id;
  }
  if (!productId) return Response.json({ error: "Choose a product." }, { status: 400 });
  return Response.json(await productForTest(shop, productId));
});
