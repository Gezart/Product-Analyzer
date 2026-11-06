import { recordEvent } from "@/lib/ab-tests-shopify";
import { proxyJson, proxyRoute } from "@/lib/storefront";

const MAX_EVENT_BYTES = 1024;

/** The JSON body, read up to `max` bytes (whatever Content-Length says): undefined when longer, null when not JSON. */
async function readCapped(request, max) {
  if (Number(request.headers.get("content-length") ?? 0) > max) return undefined;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"));
  } catch {
    return null;
  }
}

// The storefront's calls through the app proxy (/apps/unstuck/… on the shop's domain). Each path is
// handled by the feature that needs it; every request's signature is checked first (proxyRoute).
export const GET = proxyRoute(async ({ path }) => {
  if (path === "ping") return proxyJson({ ok: true });
  return proxyJson({ error: "Not found" }, { status: 404 });
});

export const POST = proxyRoute(async ({ request, shop, path }) => {
  // A/B tests: a visitor's view or add to cart (sent only with tracking consent; a few ids, never more).
  if (path === "ab") {
    const body = await readCapped(request, MAX_EVENT_BYTES);
    if (body === undefined) return proxyJson({ error: "Too large" }, { status: 413 });
    return proxyJson({ ok: await recordEvent(shop.id, body) });
  }
  return proxyJson({ error: "Not found" }, { status: 404 });
});
