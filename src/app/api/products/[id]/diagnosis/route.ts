import { authenticate, AuthError } from "@/lib/auth";
import { diagnoseProduct } from "@/lib/diagnose-product";

// Why this product isn't selling: rule-based reasons, each with its evidence.
export async function GET(request: Request, ctx: RouteContext<"/api/products/[id]/diagnosis">) {
  try {
    const { shop } = await authenticate(request);
    const { id } = await ctx.params;
    const diagnosis = await diagnoseProduct(shop.id, id);
    return diagnosis ? Response.json(diagnosis) : new Response("Not found", { status: 404 });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
