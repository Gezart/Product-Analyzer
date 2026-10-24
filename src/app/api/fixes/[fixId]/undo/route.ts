import { authenticate, AuthError } from "@/lib/auth";
import { FixError, undoFix } from "@/lib/fix-center";

// Body: { force?: boolean } — force overwrites changes made to the product after the fix.
export async function POST(request: Request, ctx: RouteContext<"/api/fixes/[fixId]/undo">) {
  try {
    const { shop } = await authenticate(request);
    const { fixId } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { force?: boolean } | null;
    return Response.json(await undoFix(shop.id, fixId, { force: body?.force === true }));
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    if (error instanceof FixError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
