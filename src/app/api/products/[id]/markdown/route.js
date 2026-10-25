import { overLimitUpgrade, requireFeature, requireWithinLimit } from "@/lib/feature-gate";
import { approveMarkdown, markdownOverview } from "@/lib/markdown-engine";
import { FEATURE_PLAN, hasFeature } from "@/lib/plans";
import { appRoute, readJson } from "@/lib/route";

/**
 * The product's markdown: the running (or last) plan, and — when it qualifies (rescue plan ended with
 * no change, or dead stock) and nothing is running — a preview of the ladder from live prices.
 */
export const GET = appRoute(async ({ shop, params }) => {
  const { id } = params;
  const upgrade = hasFeature(shop.plan, "markdown") ? await overLimitUpgrade(shop, id) : FEATURE_PLAN.markdown;
  return Response.json({ ...(await markdownOverview(shop.id, id, { preview: !upgrade })), upgrade });
});

// Body: { expected: LadderProposal } — the previewed schedule the merchant approved.
export const POST = appRoute(async ({ request, shop, params }) => {
  const { id } = params;
  requireFeature(shop, "markdown");
  await requireWithinLimit(shop, id);
  const body = await readJson(request);
  return Response.json(await approveMarkdown(shop.id, id, body?.expected));
});
