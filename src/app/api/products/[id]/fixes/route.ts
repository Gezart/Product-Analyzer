import { authenticate, AuthError } from "@/lib/auth";
import { applyFix, FixError } from "@/lib/fix-center";
import { validateFix } from "@/lib/fixes";

// Body: { type, after, diagnosisId? }. The merchant's click is the approval; the fix is applied now.
export async function POST(request: Request, ctx: RouteContext<"/api/products/[id]/fixes">) {
  try {
    const { shop } = await authenticate(request);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { type?: string; after?: unknown; diagnosisId?: string } | null;
    const valid = validateFix(body?.type ?? "", body?.after);
    if (!valid.ok) return Response.json({ error: valid.error }, { status: 400 });
    const fix = await applyFix(shop.id, id, valid.type, valid.after, body?.diagnosisId);
    return Response.json(fix);
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    if (error instanceof FixError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
