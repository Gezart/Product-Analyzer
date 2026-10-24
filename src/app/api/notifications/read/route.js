import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";

// Body: { ids: string[] } marks those items read; { all: true } marks every item read.
export async function POST(request) {
  try {
    const { shop } = await authenticate(request);
    const body = await request.json().catch(() => null);
    const ids = Array.isArray(body?.ids) && body.ids.length <= 100 && body.ids.every((id) => typeof id === "string") ? body.ids : null;
    if (!ids && body?.all !== true) return Response.json({ error: "Send ids or all" }, { status: 400 });
    const { count } = await db().notification.updateMany({
      where: { shopId: shop.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return Response.json({ marked: count });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
