import "@shopify/shopify-api/adapters/web-api";
import {
  ApiVersion,
  BillingInterval,
  BillingReplacementBehavior,
  shopifyApi,
  type BillingConfig,
  type Shopify,
} from "@shopify/shopify-api";
import { env } from "@/lib/env";
import { PAID_PLANS, TRIAL_DAYS } from "@/lib/plans";

let instance: Shopify | undefined;

const billing: BillingConfig = Object.fromEntries(
  PAID_PLANS.map((plan) => [
    plan.name,
    {
      trialDays: TRIAL_DAYS,
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
      lineItems: [{ amount: plan.price, currencyCode: "USD", interval: BillingInterval.Every30Days }],
    },
  ]),
);

// Lazy so `next build` does not need Shopify credentials.
export function shopify(): Shopify {
  instance ??= shopifyApi({
    apiKey: env.shopifyApiKey,
    apiSecretKey: env.shopifyApiSecret,
    scopes: env.shopifyScopes,
    hostName: new URL(env.appUrl).host,
    hostScheme: "https",
    apiVersion: ApiVersion.October26,
    isEmbeddedApp: true,
    billing,
  });
  return instance;
}
