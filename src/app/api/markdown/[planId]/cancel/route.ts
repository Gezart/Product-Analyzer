import { authenticate, AuthError } from "@/lib/auth";
import { cancelMarkdown, MarkdownError } from "@/lib/markdown-engine";

// Stops a running markdown and restores the original prices (where they're still the plan's).
export async function POST(request: Request, ctx: RouteContext<"/api/markdown/[planId]/cancel">) {
  try {
    const { shop } = await authenticate(request);
    const { planId } = await ctx.params;
    await cancelMarkdown(shop.id, planId);
    return Response.json({ cancelled: true });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    if (error instanceof MarkdownError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
