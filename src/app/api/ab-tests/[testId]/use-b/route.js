import { applyVersionB } from "@/lib/ab-tests-shopify";
import { db } from "@/lib/db";
import { requireFeature, requireWithinLimit } from "@/lib/feature-gate";
import { HttpError } from "@/lib/http-error";
import { appRoute } from "@/lib/route";

// "Use B now": version B goes on the product as a fix (with Undo, measured like any fix) and the test ends.
export const POST = appRoute(async ({ shop, params }) => {
  requireFeature(shop, "fixCenter");
  const test = await db().abTest.findFirst({ where: { id: params.testId, shopId: shop.id }, select: { productId: true } });
  if (!test) throw new HttpError("Test not found", 404);
  await requireWithinLimit(shop, test.productId);
  const updated = await applyVersionB(shop, params.testId);
  return Response.json({ ok: true, fixId: updated.fixId });
});
