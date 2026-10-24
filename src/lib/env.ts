function required(name: string): string {
  const value = process.env[name];
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
    return required("SHOPIFY_SCOPES").split(",").map((s) => s.trim());
  },
  get appUrl() {
    return required("SHOPIFY_APP_URL");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get encryptionKey() {
    return required("ENCRYPTION_KEY");
  },
};
