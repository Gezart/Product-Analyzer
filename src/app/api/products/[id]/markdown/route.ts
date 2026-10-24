import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import type { LadderProposal } from "@/lib/markdown";
import { approveMarkdown, LADDER, MarkdownError, previewMarkdown } from "@/lib/markdown-engine";

function handle(error: unknown) {
  if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
  if (error instanceof MarkdownError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
}

/**
 * The product's markdown: the running (or last) plan, and — when it qualifies (rescue plan ended with
 * no change, or dead stock) and nothing is running — a preview of the ladder from live prices.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/products/[id]/markdown">) {
  try {
    const { shop } = await authenticate(request);
    const { id } = await ctx.params;
    const product = await db().product.findFirst({ where: { id, shopId: shop.id }, select: { id: true } });
    if (!product) return new Response("Not found", { status: 404 });
    const [plan, rescue, score, changes] = await Promise.all([
      db().markdownPlan.findFirst({ where: { productId: id }, orderBy: { startedAt: "desc" } }),
      db().rescuePlan.findFirst({ where: { productId: id }, orderBy: { startedAt: "desc" } }),
      db().productScore.findFirst({ where: { productId: id }, orderBy: { computedAt: "desc" }, select: { status: true } }),
      db().priceChange.findMany({ where: { productId: id }, orderBy: { changedAt: "desc" }, take: 30 }),
    ]);
    const running = plan && ["active", "paused"].includes(plan.status);
    const reason =
      rescue?.verdict === "no_change" ? "The rescue plan ended with no change." : score?.status === "dead_stock" ? "Dead stock: no sale for a long time." : null;
    const preview = !running && reason ? await previewMarkdown(shop.id, id) : null;
    return Response.json({ plan, eligible: reason, preview, ladder: LADDER, priceChanges: changes });
  } catch (error) {
    return handle(error);
  }
}

// Body: { expected: LadderProposal } — the previewed schedule the merchant approved.
export async function POST(request: Request, ctx: RouteContext<"/api/products/[id]/markdown">) {
  try {
    const { shop } = await authenticate(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { expected?: LadderProposal } | null;
    if (!body?.expected) return Response.json({ error: "Approve the previewed schedule" }, { status: 400 });
    return Response.json(await approveMarkdown(shop.id, id, body.expected));
  } catch (error) {
    return handle(error);
  }
}
