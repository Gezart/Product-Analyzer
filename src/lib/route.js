import { authenticate, AuthError } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";
import { shopifyFailure } from "@/lib/shopify-errors";

/**
 * Route handler for the embedded app. Authenticates the request (401 when it can't), calls
 * `handler({ request, shop, session, params })`, and answers expected failures (`HttpError`) with
 * `{ error }` and their status, and a failed Shopify call with a readable 502. Anything else is a real
 * failure: Next.js logs it and answers 500.
 */
export function appRoute(handler) {
  return async (request, ctx) => {
    try {
      const { shop, session } = await authenticate(request);
      const params = ctx?.params ? await ctx.params : {};
      return await handler({ request, shop, session, params });
    } catch (error) {
      if (error instanceof AuthError) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (error instanceof HttpError) return Response.json({ ...error.data, error: error.message }, { status: error.status });
      const shopify = shopifyFailure(error);
      if (shopify) {
        console.error("[shopify]", error.message);
        return Response.json({ error: shopify }, { status: 502 });
      }
      throw error;
    }
  };
}

/** The request's JSON body, or null when it isn't valid JSON. */
export async function readJson(request) {
  return request.json().catch(() => null);
}
