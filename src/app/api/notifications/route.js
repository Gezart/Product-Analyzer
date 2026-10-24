import { authenticate, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { describe } from "@/lib/notifications";

// The inbox: the latest 50 items with their text and link, plus the number unread.
export async function GET(request) {
  try {
    const { shop } = await authenticate(request);
    const [items, unread] = await Promise.all([
      db().notification.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { product: { select: { title: true } } },
      }),
      db().notification.count({ where: { shopId: shop.id, readAt: null } }),
    ]);
    return Response.json({
      unread,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        createdAt: n.createdAt,
        read: n.readAt != null,
        ...describe({ type: n.type, productId: n.productId, productTitle: n.product?.title, data: n.data }),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
