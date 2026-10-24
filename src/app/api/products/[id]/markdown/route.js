import { authenticate, AuthError } from "@/lib/auth";
import { featureGate } from "@/lib/feature-gate";
import { approveMarkdown, MarkdownError, markdownOverview } from "@/lib/markdown-engine";
import { FEATURE_PLAN, hasFeature } from "@/lib/plans";

function handle(error) {
  if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
  if (error instanceof MarkdownError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
}

/**
 * The product's markdown: the running (or last) plan, and — when it qualifies (rescue plan ended with
 * no change, or dead stock) and nothing is running — a preview of the ladder from live prices.
 */
export async function GET(request, ctx) {
  try {
    const { shop } = await authenticate(request);
    const { id } = await ctx.params;
    const allowed = hasFeature(shop.plan, "markdown");
    return Response.json({ ...(await markdownOverview(shop.id, id, { preview: allowed })), upgrade: allowed ? null : FEATURE_PLAN.markdown });
  } catch (error) {
    return handle(error);
  }
}

// Body: { expected: LadderProposal } — the previewed schedule the merchant approved.
export async function POST(request, ctx) {
  try {
    const { shop } = await authenticate(request);
    const { id } = await ctx.params;
    const blocked = featureGate(shop, "markdown");
    if (blocked) return blocked;
    const body = (await request.json().catch(() => null));
    return Response.json(await approveMarkdown(shop.id, id, body?.expected));
  } catch (error) {
    return handle(error);
  }
}
