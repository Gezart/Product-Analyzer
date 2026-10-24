import { authenticate, AuthError } from "@/lib/auth";
import { approveMarkdown, MarkdownError, markdownOverview } from "@/lib/markdown-engine";

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
    return Response.json(await markdownOverview(shop.id, id));
  } catch (error) {
    return handle(error);
  }
}

// Body: { expected: LadderProposal } — the previewed schedule the merchant approved.
export async function POST(request: Request, ctx: RouteContext<"/api/products/[id]/markdown">) {
  try {
    const { shop } = await authenticate(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { expected?: unknown } | null;
    return Response.json(await approveMarkdown(shop.id, id, body?.expected));
  } catch (error) {
    return handle(error);
  }
}
