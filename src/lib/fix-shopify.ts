import type { Session } from "@shopify/shopify-api";
import { adminGraphql } from "@/lib/admin";
import { collectionChanges, mediaMoves, type FixState, type FixType } from "@/lib/fixes";

type UserError = { field?: string[] | null; message: string };

const STATE_QUERY = `#graphql
  query FixState($id: ID!) {
    product(id: $id) {
      id title descriptionHtml
      seo { title description }
      media(first: 100) { nodes { id alt mediaContentType preview { image { url } } } }
      collections(first: 100) { nodes { id title ruleSet { appliedDisjunctively } } }
    }
  }`;

export type LiveProduct = {
  title: string;
  descriptionHtml: string;
  seo: { title: string | null; description: string | null };
  media: { id: string; alt: string | null; type: string; previewUrl: string | null }[];
  /** All collections the product is in; `manual` ones can be edited. */
  collections: { id: string; title: string; manual: boolean }[];
};

/** The product's current editable fields, read live from Shopify. */
export async function readLiveProduct(session: Session, productGid: string): Promise<LiveProduct | null> {
  type Node = {
    title: string;
    descriptionHtml: string;
    seo: { title: string | null; description: string | null };
    media: { nodes: { id: string; alt: string | null; mediaContentType: string; preview: { image: { url: string } | null } | null }[] };
    collections: { nodes: { id: string; title: string; ruleSet: object | null }[] };
  };
  const data = await adminGraphql<{ product: Node | null }>(session, STATE_QUERY, { id: productGid });
  const p = data.product;
  if (!p) return null;
  return {
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    seo: p.seo,
    media: p.media.nodes.map((m) => ({ id: m.id, alt: m.alt, type: m.mediaContentType, previewUrl: m.preview?.image?.url ?? null })),
    collections: p.collections.nodes.map((c) => ({ id: c.id, title: c.title, manual: c.ruleSet == null })),
  };
}

/** The part of the live product a fix type changes. */
export function stateOf<T extends FixType>(live: LiveProduct, type: T): FixState[T] {
  const states: FixState = {
    title: { title: live.title },
    description: { descriptionHtml: live.descriptionHtml },
    seo: { seoTitle: live.seo.title ?? "", seoDescription: live.seo.description ?? "" },
    images: { mediaIds: live.media.map((m) => m.id) },
    collection: { collectionIds: live.collections.filter((c) => c.manual).map((c) => c.id).sort() },
  };
  return states[type];
}

function check(errors: UserError[] | undefined, what: string) {
  if (errors?.length) throw new Error(`${what}: ${errors.map((e) => e.message).join("; ")}`);
}

/**
 * Waits (briefly) for an async Shopify job, e.g. media reorder or collection removal. Returns false
 * when it isn't confirmed done in time: the change is then still being applied by Shopify.
 */
async function waitForJob(session: Session, job: { id: string; done: boolean } | null): Promise<boolean> {
  if (!job || job.done) return true; // no job returned: the change was applied synchronously
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const data = await adminGraphql<{ job: { done: boolean } | null }>(session, `#graphql
      query Job($id: ID!) { job(id: $id) { done } }`, { id: job.id });
    if (data.job?.done) return true;
  }
  return false;
}

const PRODUCT_UPDATE = `#graphql
  mutation FixProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) { product { id } userErrors { field message } }
  }`;

/**
 * Writes one fix type's state to Shopify (`current` is needed to compute moves and collection diffs).
 * Returns `{ pending: true }` when Shopify accepted the change but its async job wasn't done yet.
 */
export async function writeState(
  session: Session,
  productGid: string,
  type: FixType,
  current: unknown,
  target: unknown,
): Promise<{ pending: boolean }> {
  type UpdateResult = { productUpdate: { userErrors: UserError[] } };
  switch (type) {
    case "title": {
      const { title } = target as FixState["title"];
      const r = await adminGraphql<UpdateResult>(session, PRODUCT_UPDATE, { product: { id: productGid, title } });
      check(r.productUpdate.userErrors, "Title");
      return { pending: false };
    }
    case "description": {
      const { descriptionHtml } = target as FixState["description"];
      const r = await adminGraphql<UpdateResult>(session, PRODUCT_UPDATE, { product: { id: productGid, descriptionHtml } });
      check(r.productUpdate.userErrors, "Description");
      return { pending: false };
    }
    case "seo": {
      const { seoTitle, seoDescription } = target as FixState["seo"];
      const r = await adminGraphql<UpdateResult>(session, PRODUCT_UPDATE, {
        product: { id: productGid, seo: { title: seoTitle, description: seoDescription } },
      });
      check(r.productUpdate.userErrors, "SEO");
      return { pending: false };
    }
    case "images": {
      const moves = mediaMoves((current as FixState["images"]).mediaIds, (target as FixState["images"]).mediaIds);
      if (!moves.length) return { pending: false };
      const r = await adminGraphql<{
        productReorderMedia: { job: { id: string; done: boolean } | null; mediaUserErrors: UserError[] };
      }>(
        session,
        `#graphql
        mutation FixMediaOrder($id: ID!, $moves: [MoveInput!]!) {
          productReorderMedia(id: $id, moves: $moves) { job { id done } mediaUserErrors { field message } }
        }`,
        { id: productGid, moves },
      );
      check(r.productReorderMedia.mediaUserErrors, "Image order");
      return { pending: !(await waitForJob(session, r.productReorderMedia.job)) };
    }
    case "collection": {
      // Note: re-adding to a manually sorted collection puts the product at the end of it.
      const { add, remove } = collectionChanges((current as FixState["collection"]).collectionIds, (target as FixState["collection"]).collectionIds);
      let pending = false;
      for (const id of add) {
        const r = await adminGraphql<{ collectionAddProducts: { userErrors: UserError[] } }>(
          session,
          `#graphql
          mutation FixAddToCollection($id: ID!, $productIds: [ID!]!) {
            collectionAddProducts(id: $id, productIds: $productIds) { collection { id } userErrors { field message } }
          }`,
          { id, productIds: [productGid] },
        );
        check(r.collectionAddProducts.userErrors, "Add to collection");
      }
      for (const id of remove) {
        const r = await adminGraphql<{ collectionRemoveProducts: { job: { id: string; done: boolean } | null; userErrors: UserError[] } }>(
          session,
          `#graphql
          mutation FixRemoveFromCollection($id: ID!, $productIds: [ID!]!) {
            collectionRemoveProducts(id: $id, productIds: $productIds) { job { id done } userErrors { field message } }
          }`,
          { id, productIds: [productGid] },
        );
        check(r.collectionRemoveProducts.userErrors, "Remove from collection");
        if (!(await waitForJob(session, r.collectionRemoveProducts.job))) pending = true;
      }
      return { pending };
    }
  }
}

/** Manual collections of the shop, to add a product to. */
export async function manualCollections(session: Session) {
  const data = await adminGraphql<{ collections: { nodes: { id: string; title: string }[] } }>(
    session,
    `#graphql
    query ManualCollections { collections(first: 250, query: "collection_type:custom", sortKey: TITLE) { nodes { id title } } }`,
  );
  return data.collections.nodes;
}
