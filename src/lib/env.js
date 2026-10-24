// `shopify app dev` passes the scopes as SCOPES and the tunnel URL as SHOPIFY_APP_URL (or HOST).
function required(name, ...fallbacks) {
  const value = [name, ...fallbacks].map((n) => process.env[n]).find(Boolean);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  get shopifyApiKey() {
    return required("SHOPIFY_API_KEY");
  },
  get shopifyApiSecret() {
    return required("SHOPIFY_API_SECRET");
  },
  get shopifyScopes() {
    return required("SHOPIFY_SCOPES", "SCOPES").split(",").map((s) => s.trim());
  },
  get appUrl() {
    return required("SHOPIFY_APP_URL", "HOST", "APP_URL");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get encryptionKey() {
    return required("ENCRYPTION_KEY");
  },
};

/** Test charges outside production; in production only when SHOPIFY_BILLING_TEST=true. */
export const billingIsTest =
  process.env.NODE_ENV !== "production" || process.env.SHOPIFY_BILLING_TEST === "true";
