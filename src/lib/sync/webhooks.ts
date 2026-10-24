import { DeliveryMethod, type Session } from "@shopify/shopify-api";
import { shopify } from "@/lib/shopify";

/** Topics subscribed per shop (compliance topics are set in the Partner Dashboard instead). */
export const WEBHOOK_TOPICS = [
  "APP_UNINSTALLED",
  "APP_SUBSCRIPTIONS_UPDATE",
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "INVENTORY_LEVELS_UPDATE",
] as const;

let handlersAdded = false;

/** Subscribes the shop to every topic (idempotent: existing subscriptions are kept or updated). */
export async function registerWebhooks(session: Session) {
  const api = shopify();
  if (!handlersAdded) {
    api.webhooks.addHandlers(
      Object.fromEntries(
        WEBHOOK_TOPICS.map((topic) => [topic, [{ deliveryMethod: DeliveryMethod.Http, callbackUrl: "/api/webhooks" }]]),
      ),
    );
    handlersAdded = true;
  }
  const results = await api.webhooks.register({ session });
  const failed = Object.entries(results)
    .filter(([, list]) => list.some((r) => !r.success))
    .map(([topic, list]) => `${topic}: ${JSON.stringify(list.find((r) => !r.success)?.result).slice(0, 200)}`);
  if (failed.length) throw new Error(`Webhook registration failed — ${failed.join("; ")}`);
}
