import { stopTest } from "@/lib/ab-tests-shopify";
import { appRoute } from "@/lib/route";

// Stops a running test: every visitor sees the product page as it is again.
export const POST = appRoute(async ({ shop, params }) => {
  await stopTest(shop, params.testId);
  return Response.json({ ok: true });
});
