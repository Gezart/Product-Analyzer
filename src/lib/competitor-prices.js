// Competitor links per product: adding and removing them, and reading their prices (when added and
// every night). Pages are fetched only through `fetchPublicPage`, which never reaches a private address.

import { readCompetitorPrice } from "@/lib/competitor-price";
import { db } from "@/lib/db";
import { productBenchmark } from "@/lib/google-benchmark";
import { googleIsFresh } from "@/lib/google-merchant";
import { HttpError } from "@/lib/http-error";
import { competitorSummary, gapToMarket, marketFrom } from "@/lib/market-price";
import { hasFeature } from "@/lib/plans";
import { normalizeLink } from "@/lib/public-address";
import { fetchPublicPage, PageFetchError } from "@/lib/public-fetch";

export const MAX_LINKS = 5;
const PARALLEL = 3;
/** A nightly run stops starting new reads after this long (the job times out at 5 min); the rest follow. */
const RUN_BUDGET_MS = 3 * 60 * 1000;
/** Links read more recently than this are skipped by the nightly run (e.g. added during the day). */
const FRESH_MS = 20 * 60 * 60 * 1000;

const LINK_FIELDS = { id: true, url: true, host: true, price: true, currency: true, status: true, error: true, checkedAt: true, createdAt: true };

const toJson = (l) => ({ ...l, price: l.price == null ? null : Number(l.price) });

/**
 * Reads one link and stores the result. A failed read keeps the last price but marks the link failed.
 * A read stopped by `signal` (job timeout or shutdown) stores nothing.
 */
export async function refreshLink(link, { fetchPage = fetchPublicPage, currency = null, signal } = {}) {
  const checkedAt = new Date();
  try {
    const found = await readCompetitorPrice(link.url, fetchPage, { currency, signal });
    await db().competitorLink.update({ where: { id: link.id }, data: { price: found.price, currency: found.currency, status: "ok", error: null, checkedAt } });
  } catch (error) {
    if (signal?.aborted) return;
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
  let created;
  try {
    // The product row is locked so two requests at once can't both add a 6th link.
    created = await db().$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${productId} AND "shop_id" = ${shopId} FOR UPDATE`;
      if (!rows.length) throw new HttpError("Product not found.", 404);
      const count = await tx.competitorLink.count({ where: { productId } });
      if (count >= MAX_LINKS) throw new HttpError(`A product can have up to ${MAX_LINKS} competitor links.`, 409);
      return tx.competitorLink.create({ data: { shopId, productId, url: link.url, host: link.host }, select: LINK_FIELDS });
    });
  } catch (error) {
    if (error?.code === "P2002") throw new HttpError("This link is already added.", 409);
    throw error;
  }
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { currency: true } });
  await refreshLink(created, { fetchPage, currency: shop?.currency ?? null });
  return listLinks(shopId, productId);
}

export async function removeLink(shopId, productId, linkId) {
  await db().competitorLink.deleteMany({ where: { id: String(linkId ?? ""), shopId, productId } });
  return listLinks(shopId, productId);
}

/**
 * Nightly: reads the links of the shop's active products not read in the last 20 hours, oldest first,
 * a few at a time, for up to 3 minutes. Returns how many were read and how many are still waiting
 * (the caller queues a follow-up run for those). Skipped below the plan.
 */
export async function refreshShopLinks(shopId, signal, { fetchPage = fetchPublicPage, budgetMs = RUN_BUDGET_MS } = {}) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { plan: true, currency: true, uninstalledAt: true } });
  if (!shop || shop.uninstalledAt || !hasFeature(shop.plan, "marketPrice")) return { checked: 0, remaining: 0 };
  const started = Date.now();
  const links = await db().competitorLink.findMany({
    where: { shopId, product: { status: "ACTIVE" }, OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(started - FRESH_MS) } }] },
    orderBy: { checkedAt: { sort: "asc", nulls: "first" } },
    select: { id: true, url: true },
  });
  let next = 0;
  const worker = async () => {
    while (next < links.length && !signal?.aborted && Date.now() - started < budgetMs) {
      await refreshLink(links[next++], { fetchPage, currency: shop.currency, signal });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, links.length) }, worker));
  const checked = Math.min(next, links.length);
  return { checked, remaining: links.length - checked };
}

/**
 * For the product list: each product's gap to its market price in the shop's currency (the competitors'
 * median, or else Google's benchmark), as a share above (positive) or below. Products without a
 * comparable price are left out. `productId` (the product page) or `productIds` (Compare) limits it.
 */
export async function marketGaps(shop, { productId, productIds } = {}) {
  if (!shop.currency || !hasFeature(shop.plan, "marketPrice")) return new Map();
  const one = productId ? { productId } : productIds ? { productId: { in: productIds } } : {};
  const links = await db().competitorLink.findMany({
    where: { shopId: shop.id, ...one, status: "ok", currency: shop.currency, product: { status: { not: "DELETED" } } },
    select: { productId: true, price: true, currency: true, status: true, product: { select: { price: true } } },
  });
  const byProduct = new Map();
  for (const link of links) {
    const list = byProduct.get(link.productId) ?? [];
    list.push(link);
    byProduct.set(link.productId, list);
  }
  const gaps = new Map();
  for (const [productId, list] of byProduct) {
    const gap = gapToMarket(Number(list[0].product.price), competitorSummary(list, shop.currency).median);
    if (gap != null) gaps.set(productId, gap);
  }
  if (!(await googleIsFresh(shop.id))) return gaps;
  const benchmarks = await db().googleBenchmark.findMany({
    where: { shopId: shop.id, ...one, currency: shop.currency, product: { status: { not: "DELETED" } } },
    select: { productId: true, price: true, benchmark: true, currency: true, country: true, product: { select: { price: true } } },
  });
  const byProductGoogle = new Map();
  for (const row of benchmarks) {
    if (gaps.has(row.productId)) continue;
    const list = byProductGoogle.get(row.productId) ?? [];
    list.push(row);
    byProductGoogle.set(row.productId, list);
  }
  for (const [productId, rows] of byProductGoogle) {
    const price = Number(rows[0].product.price);
    const gap = gapToMarket(price, marketFrom(null, productBenchmark(rows, shop.currency, price))?.median);
    if (gap != null) gaps.set(productId, gap);
  }
  return gaps;
}
