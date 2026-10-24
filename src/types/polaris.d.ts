// Polaris web components (<s-*>) and App Bridge elements (<ui-*>) are loaded from Shopify's CDN.
// Loose JSX typing so TypeScript accepts them without an extra types package.
import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      [tag: `s-${string}`]: Record<string, unknown> & { children?: React.ReactNode };
      [tag: `ui-${string}`]: Record<string, unknown> & { children?: React.ReactNode };
    }
  }
}
