// In development the app is opened through an HTTPS tunnel inside Shopify Admin; Next.js only serves
// its dev assets to hosts it knows, so the tunnel's host is allowed here.
const tunnelHost = (() => {
  try {
    return new URL(process.env.SHOPIFY_APP_URL ?? process.env.HOST ?? "").hostname;
  } catch {
    return null;
  }
})();

const nextConfig = {
  allowedDevOrigins: [...(tunnelHost ? [tunnelHost] : []), "*.trycloudflare.com", "*.ngrok-free.app", "*.ngrok.app"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
