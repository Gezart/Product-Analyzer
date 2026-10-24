import { db } from "@/lib/db";

/** Adds an inbox item. A failed insert is logged, never thrown: it must not break the job that sent it. */
export async function notify({ shopId, type, productId = null, data = null }) {
  await db()
    .notification.create({ data: { shopId, type, productId, data } })
    .catch((error) => console.error("[notify]", type, error));
}
