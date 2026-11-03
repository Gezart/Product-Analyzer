// Collection Optimizer: manually sorted collections read from Shopify, and the proposed order of one
// from the app's statuses and the last 30 days of sales.

import { adminGraphql } from "@/lib/admin";
import { proposeOrder, REASONS } from "@/lib/collection-order";
import { asDate, DAY_MS } from "@/lib/dates";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { localDateKey } from "@/lib/jobs/schedule";
import { latestScores } from "@/lib/scores";

/** Collections with more products than this are not reordered here (4 pages of 250). */
export const MAX_COLLECTION_PRODUCTS = 1000;

const COLLECTIONS_QUERY = `#graphql
  query OrderCollections($after: String) {
    collections(first: 250, after: $after, sortKey: TITLE) {
      nodes { id title sortOrder productsCount { count } }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const ORDER_QUERY = `#graphql
  query CollectionOrder($id: ID!, $after: String) {
    collection(id: $id) {
      id title sortOrder
      productsCount { count }
      products(first: 250, after: $after, sortKey: COLLECTION_DEFAULT) { nodes { id } pageInfo { hasNextPage endCursor } }
    }
  }`;

export const collectionGid = (id) => (/^\d+$/.test(String(id)) ? `gid://shopify/Collection/${id}` : null);

/** The shop's collections (up to 2,500): which are sorted manually, and how many products each has. */
export async function orderCollections(session) {
  const all = [];
  let after = null;
  do {
    const data = await adminGraphql(session, COLLECTIONS_QUERY, { after });
    all.push(...data.collections.nodes);
    after = data.collections.pageInfo.hasNextPage ? data.collections.pageInfo.endCursor : null;
  } while (after && all.length < 2_500);
  return all.map((c) => {
    const count = c.productsCount?.count ?? 0;
    return { id: c.id, title: c.title, manual: c.sortOrder === "MANUAL", count, tooLarge: count > MAX_COLLECTION_PRODUCTS };
  });
}

/**
 * A collection with its products in their current order (product GIDs). 404 when it's gone; 409 when
 * it isn't sorted manually or is too large to reorder here.
 */
export async function readCollectionOrder(session, gid) {
  let collection = null;
  const productIds = [];
  let after = null;
  do {
    const data = await adminGraphql(session, ORDER_QUERY, { id: gid, after });
    collection = data.collection;
    if (!collection) throw new HttpError("Collection not found.", 404);
    if (collection.sortOrder !== "MANUAL") {
      throw new HttpError("This collection isn't sorted manually in Shopify, so its order can't be changed here.", 409);
    }
    if ((collection.productsCount?.count ?? 0) > MAX_COLLECTION_PRODUCTS) {
      throw new HttpError(`This collection has more than ${MAX_COLLECTION_PRODUCTS.toLocaleString("en")} products, too many to reorder here.`, 409);
    }
    productIds.push(...collection.products.nodes.map((n) => n.id));
    after = collection.products.pageInfo.hasNextPage ? collection.products.pageInfo.endCursor : null;
  } while (after && productIds.length < MAX_COLLECTION_PRODUCTS);
  return { id: collection.id, title: collection.title, productIds };
}

/** What the app knows of each product (by GID): title, status, 30-day revenue, money at stake, can be bought. */
async function productFacts(shop, gids) {
  const products = await db().product.findMany({
    where: { shopId: shop.id, shopifyGid: { in: gids } },
    select: { id: true, shopifyGid: true, title: true, status: true, variants: { select: { inventoryQty: true, sellsWhenOut: true } } },
  });
  const ids = products.map((p) => p.id);
  const today = asDate(localDateKey(new Date(), shop.timezone));
  const [scores, sales] = await Promise.all([
    latestScores(shop.id),
    ids.length
      ? db().productDailyMetric.groupBy({
          by: ["productId"],
          where: { productId: { in: ids }, date: { gte: new Date(today.getTime() - 30 * DAY_MS), lt: today } },
          _sum: { revenue: true },
        })
      : [],
  ]);
  const scoreOf = new Map(scores.map((s) => [s.productId, s]));
  const revenueOf = new Map(sales.map((r) => [r.productId, Number(r._sum.revenue ?? 0)]));
  return new Map(
    products.map((p) => {
      const score = scoreOf.get(p.id);
      const inStock = p.variants.some((v) => v.inventoryQty > 0 || v.sellsWhenOut);
      return [
        p.shopifyGid,
        {
          productId: p.id,
          title: p.title,
          // Not analyzed (over the plan's limit, excluded): no status, so it keeps its place.
          status: score && !["over_limit", "excluded"].includes(score.status) ? score.status : null,
          revenue30: Math.round((revenueOf.get(p.id) ?? 0) * 100) / 100,
          moneyAtStake: score?.moneyAtStake ?? 0,
          active: p.status === "ACTIVE",
          available: p.status === "ACTIVE" && inStock,
        },
      ];
    }),
  );
}

/**
 * The proposed order of a collection: each product in its current place (`from`) and proposed one
 * (`to`), with its group and reason. Products the app doesn't know yet (not synced) keep their place.
 */
export async function proposeCollectionOrder(shop, session, gid) {
  const collection = await readCollectionOrder(session, gid);
  const facts = await productFacts(shop, collection.productIds);
  const items = collection.productIds.map((id) => ({ id, status: null, revenue30: 0, moneyAtStake: 0, available: true, ...facts.get(id) }));
  const byId = new Map(items.map((p) => [p.id, p]));
  const proposal = proposeOrder(items).map((e) => {
    const p = byId.get(e.id);
    return {
      id: e.id,
      productId: p.productId ?? null,
      title: p.title ?? "Product not synced yet",
      status: p.status,
      revenue30: p.revenue30,
      group: e.group,
      reason: REASONS[e.group],
      from: e.from,
      to: e.to,
    };
  });
  return { collection: { id: collection.id, title: collection.title, count: collection.productIds.length }, current: collection.productIds, proposal };
}
