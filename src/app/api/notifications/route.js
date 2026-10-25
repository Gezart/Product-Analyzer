import { db } from "@/lib/db";
import { describe } from "@/lib/notifications";
import { appRoute } from "@/lib/route";

// The inbox: the latest 50 items with their text and link, plus the number unread (`?count=1`: only that).
export const GET = appRoute(async ({ request, shop }) => {
  if (new URL(request.url).searchParams.get("count") === "1") {
    return Response.json({ unread: await db().notification.count({ where: { shopId: shop.id, readAt: null } }) });
  }
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
});
