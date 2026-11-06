import { RULES } from "@/lib/ab-tests";
import { listTests, startTest } from "@/lib/ab-tests-shopify";
import { env } from "@/lib/env";
import { missingFeature, requireFeature, requireWithinLimit } from "@/lib/feature-gate";
import { appRoute, readJson } from "@/lib/route";

/** The theme editor's App embeds with the app's "A/B tests" embed ready to turn on (Shopify's deep link). */
const embedUrl = (domain) => `https://${domain}/admin/themes/current/editor?context=apps&template=product&activateAppId=${env.shopifyApiKey}/app-embed`;

export const GET = appRoute(async ({ shop }) => {
  const tests = await listTests(shop.id);
  return Response.json({ tests, rules: RULES, currency: shop.currency, themeEditorUrl: embedUrl(shop.domain), ...(missingFeature(shop, "abTests") ?? {}) });
});

// Body: { productId, kind, b, expected? } (`expected`: the product's current version the page showed).
export const POST = appRoute(async ({ request, shop }) => {
  requireFeature(shop, "abTests");
  const body = await readJson(request);
  if (typeof body?.productId !== "string" || !body.productId) return Response.json({ error: "Choose a product." }, { status: 400 });
  if (body.expected !== undefined && (typeof body.expected !== "object" || body.expected === null)) {
    return Response.json({ error: "expected must be an object" }, { status: 400 });
  }
  // Like a fix: only on products the plan analyzes ("Use B now" applies B as a fix).
  await requireWithinLimit(shop, body.productId);
  const test = await startTest(shop, body.productId, body.kind, body.b, body.expected);
  return Response.json({ id: test.id }, { status: 201 });
});
