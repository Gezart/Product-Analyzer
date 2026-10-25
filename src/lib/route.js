import { authenticate, AuthError } from "@/lib/auth";
import { HttpError } from "@/lib/http-error";

/**
 * Route handler for the embedded app. Authenticates the request (401 when it can't), calls
 * `handler({ request, shop, session, params })`, and answers expected failures (`HttpError`) with
 * `{ error }` and their status. Anything else is a real failure: Next.js logs it and answers 500.
 */
export function appRoute(handler) {
  return async (request, ctx) => {
    try {
      const { shop, session } = await authenticate(request);
      const params = ctx?.params ? await ctx.params : {};
      return await handler({ request, shop, session, params });
    } catch (error) {
      if (error instanceof AuthError) return new Response("Unauthorized", { status: 401 });
      if (error instanceof HttpError) return Response.json({ ...error.data, error: error.message }, { status: error.status });
      throw error;
    }
  };
}

/** The request's JSON body, or null when it isn't valid JSON. */
export async function readJson(request) {
  return request.json().catch(() => null);
}
