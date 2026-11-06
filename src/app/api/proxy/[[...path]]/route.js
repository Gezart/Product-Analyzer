import { proxyJson, proxyRoute } from "@/lib/storefront";

// The storefront's calls through the app proxy (/apps/unstuck/… on the shop's domain). Each path is
// handled by the feature that needs it; every request's signature is checked first (proxyRoute).
export const GET = proxyRoute(async ({ path }) => {
  if (path === "ping") return proxyJson({ ok: true });
  return proxyJson({ error: "Not found" }, { status: 404 });
});

export const POST = proxyRoute(async () => proxyJson({ error: "Not found" }, { status: 404 }));
