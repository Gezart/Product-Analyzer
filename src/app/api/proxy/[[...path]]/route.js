import { recordEvent } from "@/lib/ab-tests-shopify";
import { readJson } from "@/lib/route";
import { proxyJson, proxyRoute } from "@/lib/storefront";

const MAX_EVENT_BYTES = 1024;

// The storefront's calls through the app proxy (/apps/unstuck/… on the shop's domain). Each path is
// handled by the feature that needs it; every request's signature is checked first (proxyRoute).
export const GET = proxyRoute(async ({ path }) => {
  if (path === "ping") return proxyJson({ ok: true });
  return proxyJson({ error: "Not found" }, { status: 404 });
});

export const POST = proxyRoute(async ({ request, shop, path }) => {
  // A/B tests: a visitor's view or add to cart (sent only with tracking consent; a few ids, never more).
  if (path === "ab") {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_EVENT_BYTES) return proxyJson({ error: "Too large" }, { status: 413 });
    return proxyJson({ ok: await recordEvent(shop.id, await readJson(request)) });
  }
  return proxyJson({ error: "Not found" }, { status: 404 });
});
