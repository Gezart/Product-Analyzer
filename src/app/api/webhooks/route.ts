import { AuthError, getOfflineSession } from "@/lib/auth";
import { syncPlan } from "@/lib/billing";
import { db } from "@/lib/db";
import { cancelShopJobs } from "@/lib/jobs/queue";
import { shopify } from "@/lib/shopify";
import { handleInventoryWebhook, handleOrderWebhook, handleProductWebhook } from "@/lib/sync/live";
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
      await db().shop.updateMany({ where: { domain }, data: { uninstalledAt: new Date(), plan: "free" } });
      for (const shop of await db().shop.findMany({ where: { domain }, select: { id: true } })) {
        await cancelShopJobs(shop.id);
      }
      break;
    case "APP_SUBSCRIPTIONS_UPDATE":
      try {
        // Prefer the live subscription state from Shopify.
        await syncPlan(await getOfflineSession(domain));
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        // No usable token means the app is uninstalled; payloads may arrive out of order, so don't trust them.
        await db().shop.updateMany({ where: { domain }, data: { plan: "free" } });
      }
      break;
    case "ORDERS_CREATE":
    case "ORDERS_UPDATED":
    case "ORDERS_CANCELLED":
      await handleOrderWebhook(domain, JSON.parse(rawBody));
      break;
    case "PRODUCTS_CREATE":
    case "PRODUCTS_UPDATE":
    case "PRODUCTS_DELETE":
      await handleProductWebhook(domain, topic, JSON.parse(rawBody));
      break;
    case "INVENTORY_LEVELS_UPDATE":
      await handleInventoryWebhook(domain, JSON.parse(rawBody));
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
