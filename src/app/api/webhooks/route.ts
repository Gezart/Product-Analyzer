import { db } from "@/lib/db";
import { cancelShopJobs } from "@/lib/jobs/queue";
import { shopify } from "@/lib/shopify";
import { deleteSessions } from "@/lib/session-storage";

// Single endpoint for all webhooks, including the mandatory compliance topics.
// Invalid HMAC → 401 (required by App Store review).
export async function POST(request: Request) {
  const rawBody = await request.text();
  const check = await shopify().webhooks.validate({ rawBody, rawRequest: request });
  if (!check.valid) return new Response("Unauthorized", { status: 401 });

  const { topic, domain } = check;

  switch (topic) {
    case "APP_UNINSTALLED":
      await deleteSessions(domain);
      await db().shop.updateMany({ where: { domain }, data: { uninstalledAt: new Date() } });
      for (const shop of await db().shop.findMany({ where: { domain }, select: { id: true } })) {
        await cancelShopJobs(shop.id);
      }
      break;
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // We never store customer data (orders keep only date, product, variant, qty, price).
      break;
    case "SHOP_REDACT":
      // Deletes the shop and, via cascades, every row it owns.
      await deleteSessions(domain);
      await db().shop.deleteMany({ where: { domain } });
      break;
  }

  return new Response(null, { status: 200 });
}
