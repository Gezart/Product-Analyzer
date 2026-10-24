import type { Session } from "@shopify/shopify-api";
import { adminGraphql } from "@/lib/admin";

export type LiveVariant = {
  id: string;
  title: string;
  price: number;
  compareAtPrice: number | null;
  cost: number | null;
  inventory: number;
};

/** Variants' current prices, compare-at, cost and stock, read live (preview and every write use these). */
export async function readLiveVariants(session: Session, productGid: string): Promise<LiveVariant[] | null> {
  type Node = {
    id: string;
    title: string;
    price: string;
    compareAtPrice: string | null;
    inventoryQuantity: number | null;
    inventoryItem: { unitCost: { amount: string } | null } | null;
  };
  const out: LiveVariant[] = [];
  let after: string | null = null;
  for (let page = 0; page < 25; page++) {
    const data: { product: { variants: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null } =
      await adminGraphql(
        session,
        `#graphql
        query MarkdownVariants($id: ID!, $after: String) {
          product(id: $id) {
            variants(first: 100, after: $after) {
              nodes { id title price compareAtPrice inventoryQuantity inventoryItem { unitCost { amount } } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
        { id: productGid, after },
      );
    if (!data.product) return null;
    for (const v of data.product.variants.nodes) {
      out.push({
        id: v.id,
        title: v.title,
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice == null ? null : Number(v.compareAtPrice),
        cost: v.inventoryItem?.unitCost ? Number(v.inventoryItem.unitCost.amount) : null,
        inventory: v.inventoryQuantity ?? 0,
      });
    }
    if (!data.product.variants.pageInfo.hasNextPage) break;
    after = data.product.variants.pageInfo.endCursor;
  }
  return out;
}

/** Writes prices (and compare-at; null clears it) for several variants of one product. */
export async function writeVariantPrices(
  session: Session,
  productGid: string,
  updates: { id: string; price: number; compareAtPrice: number | null }[],
) {
  for (let i = 0; i < updates.length; i += 100) {
    const batch = updates.slice(i, i + 100).map((u) => ({
      id: u.id,
      price: u.price.toFixed(2),
      compareAtPrice: u.compareAtPrice == null ? null : u.compareAtPrice.toFixed(2),
    }));
    const r = await adminGraphql<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
      session,
      `#graphql
      mutation MarkdownPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price compareAtPrice }
          userErrors { field message }
        }
      }`,
      { productId: productGid, variants: batch },
    );
    const errors = r.productVariantsBulkUpdate.userErrors;
    if (errors.length) throw new Error(`Price update: ${errors.map((e) => e.message).join("; ")}`);
  }
}
