// Competitor links per product: adding and removing them, and reading their prices (when added and
// every night). Pages are fetched only through `fetchPublicPage`, which never reaches a private address.

import { priceFromHtml, priceFromShopifyJs, shopifyProductJsUrl } from "@/lib/competitor-price";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { hasFeature } from "@/lib/plans";
import { normalizeLink } from "@/lib/public-address";
import { fetchPublicPage, PageFetchError } from "@/lib/public-fetch";

export const MAX_LINKS = 5;
const PARALLEL = 3;

const LINK_FIELDS = { id: true, url: true, host: true, price: true, currency: true, status: true, error: true, checkedAt: true, createdAt: true };

const toJson = (l) => ({ ...l, price: l.price == null ? null : Number(l.price) });

/**
 * Reads a product price from a competitor page: the page's own price data first, then (for Shopify
 * stores) the product's `.js` endpoint. Throws `PageFetchError` with a readable message.
 */
export async function readCompetitorPrice(url, fetchPage = fetchPublicPage) {
  const page = await fetchPage(url);
  const found = priceFromHtml(page.body);
  if (found) return { price: found.price, currency: found.currency };
  const jsUrl = shopifyProductJsUrl(page.url);
  if (jsUrl) {
    let price = null;
    try {
      const js = await fetchPage(jsUrl, { accept: "application/json" });
      price = priceFromShopifyJs(JSON.parse(js.body));
    } catch {
      // The page itself was readable; report the missing price below.
    }
    if (price != null) return { price, currency: null };
  }
  throw new PageFetchError("No price was found on this page.");
}

/** Reads one link and stores the result. A failed read keeps the last price but marks the link failed. */
export async function refreshLink(link, fetchPage = fetchPublicPage) {
  const checkedAt = new Date();
  try {
    const { price, currency } = await readCompetitorPrice(link.url, fetchPage);
    await db().competitorLink.update({ where: { id: link.id }, data: { price, currency, status: "ok", error: null, checkedAt } });
  } catch (error) {
    if (!(error instanceof PageFetchError)) console.error("[competitor-price]", link.url, error);
    const message = error instanceof PageFetchError ? error.message : "The page couldn't be read.";
    await db().competitorLink.update({ where: { id: link.id }, data: { status: "failed", error: message.slice(0, 300), checkedAt } });
  }
}

export async function listLinks(shopId, productId) {
  const links = await db().competitorLink.findMany({ where: { shopId, productId }, orderBy: { createdAt: "asc" }, select: LINK_FIELDS });
  return links.map(toJson);
}

/** Adds a link to a product and reads its price right away. Answers 400/404/409 for bad input. */
export async function addLink(shopId, productId, input, fetchPage = fetchPublicPage) {
  const link = normalizeLink(input);
  if (link.error) throw new HttpError(link.error, 400);
  const product = await db().product.findFirst({ where: { id: productId, shopId }, select: { id: true } });
  if (!product) throw new HttpError("Product not found.", 404);
  const count = await db().competitorLink.count({ where: { productId } });
  if (count >= MAX_LINKS) throw new HttpError(`A product can have up to ${MAX_LINKS} competitor links.`, 409);
  let created;
  try {
    created = await db().competitorLink.create({ data: { shopId, productId, url: link.url, host: link.host }, select: LINK_FIELDS });
  } catch (error) {
    if (error?.code === "P2002") throw new HttpError("This link is already added.", 409);
    throw error;
  }
  await refreshLink(created, fetchPage);
  return listLinks(shopId, productId);
}

export async function removeLink(shopId, productId, linkId) {
  await db().competitorLink.deleteMany({ where: { id: String(linkId ?? ""), shopId, productId } });
  return listLinks(shopId, productId);
}

/** Nightly: reads every link of the shop's active products, a few at a time. Skipped below the plan. */
export async function refreshShopLinks(shopId, signal, fetchPage = fetchPublicPage) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { plan: true, uninstalledAt: true } });
  if (!shop || shop.uninstalledAt || !hasFeature(shop.plan, "marketPrice")) return 0;
  const links = await db().competitorLink.findMany({
    where: { shopId, product: { status: "ACTIVE" } },
    orderBy: { checkedAt: { sort: "asc", nulls: "first" } },
    select: { id: true, url: true },
  });
  let next = 0;
  const worker = async () => {
    while (next < links.length && !signal?.aborted) await refreshLink(links[next++], fetchPage);
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, links.length) }, worker));
  return links.length;
}
