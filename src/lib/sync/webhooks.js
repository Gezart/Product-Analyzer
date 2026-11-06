import { DeliveryMethod } from "@shopify/shopify-api";
import { env } from "@/lib/env";
import { shopify } from "@/lib/shopify";

const CALLBACK_PATH = "/api/webhooks";

/** Where this server receives webhooks (subscriptions made elsewhere point at another address). */
export function webhookAddress() {
  // Same as the address Shopify is given (src/lib/shopify.js: hostScheme https + hostName).
  return `https://${new URL(env.appUrl).host}${CALLBACK_PATH}`;
}

/**
 * Topics subscribed per shop (compliance topics are set in the Partner Dashboard instead). Shopify-api
 * registers them one by one and stops at an answer that throws, so the order topics (protected customer
 * data, refused until the app has access) come last.
 */
export const WEBHOOK_TOPICS = [
  "APP_UNINSTALLED",
  "APP_SUBSCRIPTIONS_UPDATE",
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "INVENTORY_LEVELS_UPDATE",
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
];

const ORDER_FIELDS = ["id", "admin_graphql_api_id", "created_at", "updated_at", "cancelled_at", "line_items", "refunds"];

let handlersAdded = false;

/** Subscribes the shop to every topic (idempotent: existing subscriptions are kept or updated). */
export async function registerWebhooks(session) {
  const api = shopify();
  if (!handlersAdded) {
    api.webhooks.addHandlers(
      Object.fromEntries(
        WEBHOOK_TOPICS.map((topic) => [
          topic,
          [
            {
              deliveryMethod: DeliveryMethod.Http,
              callbackUrl: CALLBACK_PATH,
              // Order payloads limited to what we store: no customer, address or contact fields.
              ...(topic.startsWith("ORDERS_") ? { includeFields: ORDER_FIELDS } : {}),
            },
          ],
        ]),
      ),
    );
    handlersAdded = true;
  }
  const results = await api.webhooks.register({ session });
  const failed = Object.entries(results)
    .filter(([, list]) => list.some((r) => !r.success))
    .map(([topic, list]) => ({ topic, detail: JSON.stringify(list.find((r) => !r.success)?.result) ?? "" }));
  if (failed.length) throw new WebhookRegistrationError(failed);
}

/** Shopify's refusal for order topics until the app has protected customer data access. */
const PROTECTED_DATA = /protected customer data/i;

/** Some topics failed; the others were subscribed (Shopify handles each topic on its own). */
export class WebhookRegistrationError extends Error {
  constructor(failed) {
    super(`Webhook registration failed — ${failed.map((f) => `${f.topic}: ${f.detail.slice(0, 200)}`).join("; ")}`);
    this.topics = failed.map((f) => f.topic);
    /** Only refused for protected customer data: retrying can't help until the owner gets access. */
    this.protectedDataOnly = failed.every((f) => PROTECTED_DATA.test(f.detail));
  }
}
