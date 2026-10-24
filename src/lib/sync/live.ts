import { adminGraphql } from "@/lib/admin";
import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { PermanentJobError } from "@/lib/jobs/errors";
import { enqueue, type ClaimedJob } from "@/lib/jobs/queue";
import { applyOrderLines, markProductDeleted, rebuildProductSales, upsertProducts } from "@/lib/sync/store";
import { assembleProducts, orderLinesFromWebhook, rowsFromProductNode, type OrderWebhook } from "@/lib/sync/transform";

const PRODUCT_QUERY = `#graphql
  query SyncProduct($id: ID!) {
    product(id: $id) {
      id title handle productType vendor status createdAt description
      mediaCount { count }
      collections(first: 250) { nodes { id } }
      variants(first: 250) { nodes {
        id sku price compareAtPrice inventoryQuantity
        selectedOptions { name value }
        inventoryItem { unitCost { amount } }
      } }
    }
  }`;

async function installedShop(domain: string) {
  const shop = await db().shop.findUnique({ where: { domain } });
  return shop && !shop.uninstalledAt ? shop : null;
}

/** orders/create|updated|cancelled: stores the order's lines and rebuilds the affected days. */
export async function handleOrderWebhook(domain: string, payload: OrderWebhook) {
  const shop = await installedShop(domain);
  const orderGid = payload.admin_graphql_api_id ?? (payload.id ? `gid://shopify/Order/${payload.id}` : null);
  if (!shop || !orderGid || !payload.created_at) return;
  const updatedAt = new Date(payload.updated_at ?? payload.created_at);
  await applyOrderLines(shop.id, orderGid, updatedAt, orderLinesFromWebhook(payload, shop.timezone));
}

/** Queues a product re-sync unless one is already waiting (product updates come in bursts). */
async function queueProductSync(shopId: string, productGid: string) {
  const pending = await db().job.findFirst({
    where: { shopId, type: "sync-product", status: "queued", payload: { path: ["productGid"], equals: productGid } },
    select: { id: true },
  });
  if (!pending) await enqueue({ type: "sync-product", shopId, payload: { productGid } });
}

/** products/create|update|delete. Updates re-read the product from the API (cost and collections aren't in the payload). */
export async function handleProductWebhook(domain: string, topic: string, payload: { id?: number; admin_graphql_api_id?: string }) {
  const shop = await installedShop(domain);
  const productGid = payload.admin_graphql_api_id ?? (payload.id ? `gid://shopify/Product/${payload.id}` : null);
  if (!shop || !productGid) return;
  if (topic === "PRODUCTS_DELETE") await markProductDeleted(shop.id, productGid);
  else await queueProductSync(shop.id, productGid);
}

/** inventory_levels/update: the payload names an inventory item; the job finds its product. */
export async function handleInventoryWebhook(domain: string, payload: { inventory_item_id?: number }) {
  const shop = await installedShop(domain);
  if (!shop || !payload.inventory_item_id) return;
  const inventoryItemGid = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
  const pending = await db().job.findFirst({
    where: { shopId: shop.id, type: "sync-inventory", status: "queued", payload: { path: ["inventoryItemGid"], equals: inventoryItemGid } },
    select: { id: true },
  });
  if (!pending) await enqueue({ type: "sync-inventory", shopId: shop.id, payload: { inventoryItemGid } });
}

async function jobContext(job: ClaimedJob) {
  if (!job.shopId) throw new PermanentJobError(`${job.type} needs a shop`);
  const shop = await db().shop.findUnique({ where: { id: job.shopId } });
  if (!shop || shop.uninstalledAt) throw new PermanentJobError("Shop not installed");
  return { shopId: shop.id, session: await getOfflineSession(shop.domain) };
}

/** Job "sync-product": re-reads one product and its variants, then rebuilds its sales history. */
export async function runSyncProduct(job: ClaimedJob) {
  const { shopId, session } = await jobContext(job);
  const { productGid } = job.payload as { productGid: string };
  const data = await adminGraphql<{ product: Parameters<typeof rowsFromProductNode>[0] | null }>(session, PRODUCT_QUERY, { id: productGid });
  if (!data.product) {
    await markProductDeleted(shopId, productGid);
    return;
  }
  await upsertProducts(shopId, assembleProducts(rowsFromProductNode(data.product)), { full: false });
  // Order lines may have arrived before the product existed here.
  await rebuildProductSales(shopId, [productGid]);
}

/** Job "sync-inventory": finds the inventory item's product and queues its re-sync. */
export async function runSyncInventory(job: ClaimedJob) {
  const { shopId, session } = await jobContext(job);
  const { inventoryItemGid } = job.payload as { inventoryItemGid: string };
  const data = await adminGraphql<{ inventoryItem: { variant: { product: { id: string } } | null } | null }>(
    session,
    `#graphql
    query InventoryItemProduct($id: ID!) { inventoryItem(id: $id) { variant { product { id } } } }`,
    { id: inventoryItemGid },
  );
  const productGid = data.inventoryItem?.variant?.product.id;
  if (productGid) await queueProductSync(shopId, productGid);
}
