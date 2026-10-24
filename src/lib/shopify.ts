import "@shopify/shopify-api/adapters/web-api";
import { ApiVersion, shopifyApi, type Shopify } from "@shopify/shopify-api";
import { env } from "@/lib/env";

let instance: Shopify | undefined;

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
  });
  return instance;
}
