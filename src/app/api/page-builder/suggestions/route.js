import { db } from "@/lib/db";
import { requireFeature } from "@/lib/feature-gate";
import { BLOCK_TYPES, pageBuilderOf, validatePageBuilder, withProduct } from "@/lib/page-builder";
import { pageBuilderAnswer as answer } from "@/lib/page-builder-answer";
import { savePageBuilder } from "@/lib/page-builder-shopify";
import { appRoute, readJson } from "@/lib/route";

const GID = /^gid:\/\/shopify\/Product\/\d+$/;

// Body: { productGid, type }. "Use it": the block goes on for that product (turned on, the product added
// to its chosen products), saved and published like a save of the page.
export const POST = appRoute(async ({ request, shop, session }) => {
  requireFeature(shop, "pageBuilder");
  const body = await readJson(request);
  if (!BLOCK_TYPES.includes(body?.type) || typeof body?.productGid !== "string" || !GID.test(body.productGid)) {
    return Response.json({ error: "Not a block and product" }, { status: 400 });
  }
  const product = await db().product.findFirst({ where: { shopId: shop.id, shopifyGid: body.productGid }, select: { id: true } });
  if (!product) return Response.json({ error: "Product not found" }, { status: 404 });
  const row = await db().settings.findUnique({ where: { shopId: shop.id }, select: { pageBuilder: true } });
  const current = pageBuilderOf(row?.pageBuilder);
  const block = current.blocks.find((b) => b.type === body.type);
  // Changed meanwhile (another tab): a block now used for collections isn't narrowed to one product.
  if (block.enabled && block.useFor.mode === "collections") {
    return Response.json({ error: "This block is used for some collections now. Add the product to it on this page instead." }, { status: 409 });
  }
  const result = validatePageBuilder(withProduct(current, body.type, body.productGid));
  if (!result.ok) return Response.json({ error: result.errors[0].message }, { status: 400 });
  await savePageBuilder(shop, session, result.value);
  return answer(shop, result.value);
});
