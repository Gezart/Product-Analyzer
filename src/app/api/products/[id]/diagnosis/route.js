import { diagnoseProduct } from "@/lib/diagnose-product";
import { requireWithinLimit } from "@/lib/feature-gate";
import { appRoute } from "@/lib/route";

// Why this product isn't selling: rule-based reasons, each with its evidence.
export const GET = appRoute(async ({ shop, params }) => {
  const { id } = params;
  await requireWithinLimit(shop, id);
  const diagnosis = await diagnoseProduct(shop.id, id);
  return diagnosis ? Response.json(diagnosis) : Response.json({ error: "Not found" }, { status: 404 });
});
