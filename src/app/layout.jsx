import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Unstuck: Product Analyzer",
  description: "Find the products that don't sell, learn why, fix them.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* App Bridge must be the first script on the page and load synchronously. */}
        <meta name="shopify-api-key" content={process.env.SHOPIFY_API_KEY} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      </head>
      <body className="min-h-full flex flex-col">
        <ui-nav-menu>
          <a href="/" rel="home">
            Home
          </a>
          <a href="/inbox">Inbox</a>
          <a href="/compare">Compare</a>
          <a href="/settings">Settings</a>
          <a href="/plans">Plans</a>
        </ui-nav-menu>
        {children}
      </body>
    </html>
  );
}
