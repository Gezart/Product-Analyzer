import { authenticate, AuthError } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const { shop } = await authenticate(request);
    return Response.json({ domain: shop.domain, plan: shop.plan, installedAt: shop.installedAt });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
