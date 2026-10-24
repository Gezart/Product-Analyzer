import { NextResponse } from "next/server";

const SHOP_DOMAIN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

// Embedded apps must allow framing only by the merchant's admin.
export function proxy(request) {
  const shop = request.nextUrl.searchParams.get("shop");
  const ancestors = ["https://admin.shopify.com"];
  if (shop && SHOP_DOMAIN.test(shop)) ancestors.unshift(`https://${shop}`);

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors.join(" ")};`);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
