// Requests from the storefront, through the app proxy: who they come from, and the answers' headers.

import { verifyProxyRequest } from "@/lib/app-proxy";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http-error";

/**
 * The installed shop a proxied request comes from (with the logged-in customer's id, if any), or a 401
 * when the signature is missing, wrong or old: nothing a storefront sends is trusted before this.
 */
export async function proxyShop(request) {
  const check = verifyProxyRequest(new URL(request.url).searchParams, env.shopifyApiSecret);
  if (!check.ok) throw new HttpError("Unauthorized", 401);
  const shop = await db().shop.findFirst({ where: { domain: check.shop, uninstalledAt: null } });
  if (!shop) throw new HttpError("Unknown shop", 404);
  return { shop, customerId: check.customerId };
}

/** JSON for the storefront: never cached (answers depend on the shop and change often). */
export function proxyJson(body, init = {}) {
  return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init.headers ?? {}) } });
}

/** Wraps a proxy handler: expected failures answer `{ error }` with their status, nothing else leaks. */
export function proxyRoute(handler) {
  return async (request, ctx) => {
    try {
      const params = ctx?.params ? await ctx.params : {};
      const { shop, customerId } = await proxyShop(request);
      return await handler({ request, shop, customerId, path: (params.path ?? []).join("/") });
    } catch (error) {
      if (error instanceof HttpError) return proxyJson({ error: error.message }, { status: error.status });
      console.error("[proxy]", error);
      return proxyJson({ error: "Something went wrong" }, { status: 500 });
    }
  };
}
