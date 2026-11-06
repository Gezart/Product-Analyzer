// Page builder in Shopify: the shop's `$app.page_builder` metafield (what the theme app extension shows)
// and each product's `$app.bought_together` list. Both are app-owned (shopify.app.toml): only the app writes them.

import { adminGraphql } from "@/lib/admin";
import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { blockEnabled, boughtTogether, boughtTogetherChanges, pageBuilderOf, storefrontConfig } from "@/lib/page-builder";
import { hasFeature } from "@/lib/plans";

const APP_NAMESPACE = "$app";
/** metafieldsSet and metafieldsDelete take at most 25 metafields per call. */
const BATCH = 25;

const SHOP_ID = `#graphql
  query PageBuilderShop { shop { id } }`;

const METAFIELDS_SET = `#graphql
  mutation PageBuilderSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
  }`;

const METAFIELDS_DELETE = `#graphql
  mutation PageBuilderDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { field message } }
  }`;

const errorsText = (errors) => errors.map((e) => e.message).join("; ");

async function setMetafields(session, metafields) {
  const data = await adminGraphql(session, METAFIELDS_SET, { metafields });
  return data.metafieldsSet.userErrors;
}

/**
 * Writes what the storefront shows (only the blocks that are on, and nothing when the plan doesn't
 * include the page builder). A refused write is a 502 with Shopify's reason.
 */
export async function publishPageBuilder(session, pageBuilder, plan) {
  const { shop } = await adminGraphql(session, SHOP_ID);
  const config = storefrontConfig(pageBuilder, { included: hasFeature(plan, "pageBuilder") });
  const errors = await setMetafields(session, [
    { ownerId: shop.id, namespace: APP_NAMESPACE, key: "page_builder", type: "json", value: JSON.stringify(config) },
  ]);
  if (errors.length) throw new HttpError(`Shopify didn't save the page builder: ${errorsText(errors)}`, 502);
}

const boughtTogetherInput = ({ product, list }) => ({
  ownerId: product,
  namespace: APP_NAMESPACE,
  key: "bought_together",
  type: "list.product_reference",
  value: JSON.stringify(list),
});

/**
 * Sets the lists, 25 per call. A batch Shopify refuses (e.g. a product deleted since the last sync)
 * is retried one by one, so one bad product doesn't hold up the rest. Returns the lists written.
 */
async function writeLists(session, changes, signal) {
  const written = [];
  for (let i = 0; i < changes.length && !signal?.aborted; i += BATCH) {
    const batch = changes.slice(i, i + BATCH);
    const errors = await setMetafields(session, batch.map(boughtTogetherInput));
    if (!errors.length) {
      written.push(...batch);
      continue;
    }
    for (const change of batch) {
      const single = await setMetafields(session, [boughtTogetherInput(change)]);
      if (single.length) console.warn("[page-builder] bought together not written", change.product, errorsText(single));
      else written.push(change);
    }
  }
  return written;
}

/** Removes the lists of products nothing is bought with any more. Returns the products cleared. */
async function clearLists(session, products, signal) {
  const cleared = [];
  for (let i = 0; i < products.length && !signal?.aborted; i += BATCH) {
    const batch = products.slice(i, i + BATCH);
    const data = await adminGraphql(session, METAFIELDS_DELETE, {
      metafields: batch.map((product) => ({ ownerId: product, namespace: APP_NAMESPACE, key: "bought_together" })),
    });
    const errors = data.metafieldsDelete.userErrors;
    if (errors.length) console.warn("[page-builder] bought together not cleared", errorsText(errors));
    else cleared.push(...batch);
  }
  return cleared;
}

/**
 * "Often bought together" from the stored orders (the last 60 days): computed for every product,
 * written to Shopify where it changed, and remembered per product so the next run only writes changes.
 */
export async function refreshBoughtTogether(shopId, session, signal) {
  const [lines, products] = await Promise.all([
    db().orderLine.findMany({ where: { shopId }, select: { orderGid: true, productGid: true } }),
    db().product.findMany({ where: { shopId }, select: { shopifyGid: true, status: true, boughtTogether: true } }),
  ]);
  const eligible = new Set(products.filter((p) => p.status === "ACTIVE").map((p) => p.shopifyGid));
  const next = boughtTogether(lines, eligible);
  // Lists only go on products that are still in the store.
  for (const product of next.keys()) if (!eligible.has(product)) next.delete(product);
  const current = new Map(products.filter((p) => p.boughtTogether.length).map((p) => [p.shopifyGid, p.boughtTogether]));

  const { set, clear } = boughtTogetherChanges(current, next);
  const written = await writeLists(session, set, signal);
  const cleared = await clearLists(session, clear, signal);

  // One update per product; a run cut short keeps what was written and picks up the rest next time.
  for (const { product, list } of written) {
    await db().product.updateMany({ where: { shopId, shopifyGid: product }, data: { boughtTogether: list } });
  }
  if (cleared.length) {
    await db().product.updateMany({ where: { shopId, shopifyGid: { in: cleared } }, data: { boughtTogether: [] } });
  }
  return { products: next.size, written: written.length, cleared: cleared.length };
}

/**
 * The page builder job (after a save, a plan change and every night): publishes what the storefront
 * shows for the current plan, then refreshes "often bought together" when that block is on. Shops that
 * never turned a block on are skipped.
 */
export async function runPageBuilder(shopId, signal) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, include: { settings: { select: { pageBuilder: true } } } });
  if (!shop || shop.uninstalledAt) return;
  const pageBuilder = pageBuilderOf(shop.settings?.pageBuilder);
  if (!pageBuilder.blocks.some((b) => b.enabled)) return;

  const session = await getOfflineSession(shop.domain);
  await publishPageBuilder(session, pageBuilder, shop.plan);
  if (hasFeature(shop.plan, "pageBuilder") && blockEnabled(pageBuilder, "bought_together")) {
    await refreshBoughtTogether(shop.id, session, signal);
  }
}
