import "./globals.css";
import { AppShell } from "./ui/app-shell";

export const metadata = {
  title: "Unstuck: Product Analyzer",
  description: "Find the products that don't sell, learn why, fix them.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* App Bridge must be the first script on the page and load synchronously. */}
        <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        {/* Polaris web components stay until every screen follows the design (see docs/TASKS.md, Phase 3a). */}
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
      </head>
      <body className="min-h-full">
        {/* Only the app's own menu (the owner's design); Shopify shows just the app's name. */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
