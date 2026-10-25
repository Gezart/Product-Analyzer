import { db } from "@/lib/db";
import { appRoute, readJson } from "@/lib/route";

// Body: { ids: string[] } marks those items read; { all: true } marks every item read.
export const POST = appRoute(async ({ request, shop }) => {
  const body = await readJson(request);
  const ids = Array.isArray(body?.ids) && body.ids.length <= 100 && body.ids.every((id) => typeof id === "string") ? body.ids : null;
  if (!ids && body?.all !== true) return Response.json({ error: "Send ids or all" }, { status: 400 });
  const { count } = await db().notification.updateMany({
    where: { shopId: shop.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return Response.json({ marked: count });
});
