import { adminGraphql } from "@/lib/admin";
import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/errors";
import { enqueue } from "@/lib/jobs/queue";
import { localDateKey } from "@/lib/jobs/schedule";
import { orderWindowStart } from "@/lib/sync/initial-sync";
import { applyOrderLines, markProductDeleted, rebuildProductSales, upsertProducts } from "@/lib/sync/store";
import { assembleProducts, orderLinesFromWebhook, rowsFromProductNode } from "@/lib/sync/transform";

// Pages of 100 keep each request well under Shopify's 1,000-point query cost limit.
const PRODUCT_QUERY = `#graphql
  query SyncProduct($id: ID!) {
    product(id: $id) {
      id title handle productType vendor status createdAt description seo { title description }
      mediaCount { count }
      collections(first: 100) { nodes { id } pageInfo { hasNextPage endCursor } }
      variants(first: 100) { nodes { ...SyncVariant } pageInfo { hasNextPage endCursor } }
    }
  }
  fragment SyncVariant on ProductVariant {
    id sku price compareAtPrice inventoryQuantity inventoryPolicy
    selectedOptions { name value }
    inventoryItem { tracked unitCost { amount } }
  }`;

const MORE_VARIANTS = `#graphql
  query MoreVariants($id: ID!, $after: String) {
    product(id: $id) {
      variants(first: 100, after: $after) {
        nodes { id sku price compareAtPrice inventoryQuantity inventoryPolicy selectedOptions { name value } inventoryItem { tracked unitCost { amount } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

const MORE_COLLECTIONS = `#graphql
  query MoreCollections($id: ID!, $after: String) {
    product(id: $id) { collections(first: 100, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }
  }`;

const MAX_PAGES = 25; // 2,500 variants; Shopify allows up to 2,048

async function installedShop(domain) {
  const shop = await db().shop.findUnique({ where: { domain } });
  return shop && !shop.uninstalledAt ? shop : null;
}

/**
 * orders/create|updated|cancelled: stores the order's lines and rebuilds the affected days. Orders
 * created before the known history window are ignored (orders/updated fires for old orders too, e.g.
 * on archiving or fulfilment).
 */
export async function handleOrderWebhook(domain, payload) {
  const shop = await installedShop(domain);
  const orderGid = payload.admin_graphql_api_id ?? (payload.id ? `gid://shopify/Order/${payload.id}` : null);
  if (!shop || !orderGid || !payload.created_at) return;
  const windowStart = await orderWindowStart(shop.id, shop.timezone);
  if (localDateKey(new Date(payload.created_at), shop.timezone) < windowStart) return;
  const updatedAt = new Date(payload.updated_at ?? payload.created_at);
  await applyOrderLines(shop.id, orderGid, updatedAt, orderLinesFromWebhook(payload, shop.timezone));
}

/** Queues a product re-sync unless one is already waiting (product updates come in bursts). */
async function queueProductSync(shopId, productGid) {
  const pending = await db().job.findFirst({
    where: { shopId, type: "sync-product", status: "queued", payload: { path: ["productGid"], equals: productGid } },
    select: { id: true },
  });
  if (!pending) await enqueue({ type: "sync-product", shopId, payload: { productGid } });
}

/** products/create|update|delete. Updates re-read the product from the API (cost and collections aren't in the payload). */
export async function handleProductWebhook(domain, topic, payload) {
  const shop = await installedShop(domain);
  const productGid = payload.admin_graphql_api_id ?? (payload.id ? `gid://shopify/Product/${payload.id}` : null);
  if (!shop || !productGid) return;
  if (topic === "PRODUCTS_DELETE") await markProductDeleted(shop.id, productGid);
  else await queueProductSync(shop.id, productGid);
}

/** inventory_levels/update: the payload names an inventory item; the job finds its product. */
export async function handleInventoryWebhook(domain, payload) {
  const shop = await installedShop(domain);
  if (!shop || !payload.inventory_item_id) return;
  const inventoryItemGid = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
  const pending = await db().job.findFirst({
    where: { shopId: shop.id, type: "sync-inventory", status: "queued", payload: { path: ["inventoryItemGid"], equals: inventoryItemGid } },
    select: { id: true },
  });
  if (!pending) await enqueue({ type: "sync-inventory", shopId: shop.id, payload: { inventoryItemGid } });
}

async function jobContext(job) {
  if (!job.shopId) throw new PermanentJobError(`${job.type} needs a shop`);
  const shop = await db().shop.findUnique({ where: { id: job.shopId } });
  if (!shop || shop.uninstalledAt) throw new PermanentJobError("Shop not installed");
  return { shopId: shop.id, session: await getOfflineSession(shop.domain) };
}

/** Follows a connection's pages (up to MAX_PAGES); `complete` is false when it was cut off. */
async function remainingPages(first, next) {
  const nodes = [...first.nodes];
  let page = first;
  for (let i = 1; page.pageInfo.hasNextPage && page.pageInfo.endCursor && i < MAX_PAGES; i++) {
    const more = await next(page.pageInfo.endCursor);
    if (!more) break;
    nodes.push(...more.nodes);
    page = more;
  }
  return { nodes, complete: !page.pageInfo.hasNextPage };
}

/** Job "sync-product": re-reads one product and its variants, then rebuilds its sales history. */
export async function runSyncProduct(job) {
  const { shopId, session } = await jobContext(job);
  const { productGid } = job.payload;
  const data = await adminGraphql(session, PRODUCT_QUERY, { id: productGid });
  if (!data.product) {
    await markProductDeleted(shopId, productGid);
    return;
  }
  const variants = await remainingPages(data.product.variants, async (after) =>
    (await adminGraphql(session, MORE_VARIANTS, { id: productGid, after })).product
      ?.variants ?? null,
  );
  const collections = await remainingPages(data.product.collections, async (after) =>
    (await adminGraphql(session, MORE_COLLECTIONS, { id: productGid, after }))
      .product?.collections ?? null,
  );
  const node = { ...data.product, variants: { nodes: variants.nodes }, collections: { nodes: collections.nodes } };
  // If the variant list was cut off, don't delete the variants we didn't see.
  await upsertProducts(shopId, assembleProducts(rowsFromProductNode(node)), {
    partialVariants: variants.complete ? [] : [productGid],
  });
  // Order lines may have arrived before the product existed here.
  await rebuildProductSales(shopId, [productGid]);
}

/** Job "sync-inventory": finds the inventory item's product and queues its re-sync. */
export async function runSyncInventory(job) {
  const { shopId, session } = await jobContext(job);
  const { inventoryItemGid } = job.payload;
  const data = await adminGraphql(
    session,
    `#graphql
    query InventoryItemProduct($id: ID!) { inventoryItem(id: $id) { variant { product { id } } } }`,
    { id: inventoryItemGid },
  );
  const productGid = data.inventoryItem?.variant?.product.id;
  if (productGid) await queueProductSync(shopId, productGid);
}
