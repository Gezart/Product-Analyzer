import { adminGraphql } from "@/lib/admin";
import { EXTENSIONS } from "@/lib/ai-photo";
import { collectionChanges, mediaMoves } from "@/lib/fixes";

const STATE_QUERY = `#graphql
  query FixState($id: ID!) {
    product(id: $id) {
      id title descriptionHtml
      seo { title description }
      media(first: 100) { nodes { id alt mediaContentType preview { image { url } } } }
      collections(first: 100) { nodes { id title ruleSet { appliedDisjunctively } } }
    }
  }`;

/** The product's current editable fields, read live from Shopify. */
export async function readLiveProduct(session, productGid) {
  const data = await adminGraphql(session, STATE_QUERY, { id: productGid });
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
export function stateOf(live, type) {
  const states = {
    title: { title: live.title },
    description: { descriptionHtml: live.descriptionHtml },
    seo: { seoTitle: live.seo.title ?? "", seoDescription: live.seo.description ?? "" },
    images: { mediaIds: live.media.map((m) => m.id) },
    // A photo added by the app: undone by removing that photo (whatever the order is now).
    photo: { mediaIds: live.media.map((m) => m.id) },
    collection: { collectionIds: live.collections.filter((c) => c.manual).map((c) => c.id).sort() },
  };
  return states[type];
}

function check(errors, what) {
  if (errors?.length) throw new Error(`${what}: ${errors.map((e) => e.message).join("; ")}`);
}

/**
 * Waits (briefly) for an async Shopify job, e.g. media reorder or collection removal. Returns false
 * when it isn't confirmed done in time: the change is then still being applied by Shopify.
 */
async function waitForJob(session, job) {
  if (!job || job.done) return true; // no job returned: the change was applied synchronously
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const data = await adminGraphql(session, `#graphql
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
  session,
  productGid,
  type,
  current,
  target,
) {
  switch (type) {
    case "title": {
      const { title } = target;
      const r = await adminGraphql(session, PRODUCT_UPDATE, { product: { id: productGid, title } });
      check(r.productUpdate.userErrors, "Title");
      return { pending: false };
    }
    case "description": {
      const { descriptionHtml } = target;
      const r = await adminGraphql(session, PRODUCT_UPDATE, { product: { id: productGid, descriptionHtml } });
      check(r.productUpdate.userErrors, "Description");
      return { pending: false };
    }
    case "seo": {
      const { seoTitle, seoDescription } = target;
      const r = await adminGraphql(session, PRODUCT_UPDATE, {
        product: { id: productGid, seo: { title: seoTitle, description: seoDescription } },
      });
      check(r.productUpdate.userErrors, "SEO");
      return { pending: false };
    }
    case "images": {
      const moves = mediaMoves(current.mediaIds, target.mediaIds);
      if (!moves.length) return { pending: false };
      const r = await adminGraphql(
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
    case "photo": {
      // Only removes: the photos in `current` that `target` no longer has (the ones the fix added).
      const remove = current.mediaIds.filter((id) => !target.mediaIds.includes(id));
      if (!remove.length) return { pending: false };
      const r = await adminGraphql(
        session,
        `#graphql
        mutation FixRemovePhoto($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) { deletedMediaIds mediaUserErrors { field message } }
        }`,
        { productId: productGid, mediaIds: remove },
      );
      check(r.productDeleteMedia.mediaUserErrors, "Remove photo");
      return { pending: false };
    }
    case "collection": {
      // Note: re-adding to a manually sorted collection puts the product at the end of it.
      const { add, remove } = collectionChanges(current.collectionIds, target.collectionIds);
      let pending = false;
      for (const id of add) {
        const r = await adminGraphql(
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
        const r = await adminGraphql(
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

const STAGED_UPLOAD = `#graphql
  mutation PhotoUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } }
  }`;
const ADD_PHOTO = `#graphql
  mutation AddPhoto($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
    productUpdate(product: $product, media: $media) { product { media(last: 10) { nodes { id alt } } } userErrors { field message } }
  }`;

/**
 * Uploads an image file to Shopify and adds it to the end of the product's photos; resolves the new
 * photo's media id. `beforeIds` are the product's media before, to tell the new one apart.
 */
export async function addProductPhoto(session, productGid, { bytes, mimeType, alt, beforeIds }) {
  const filename = `photo-${Date.now()}.${EXTENSIONS[mimeType] ?? "jpg"}`;
  const staged = await adminGraphql(session, STAGED_UPLOAD, {
    input: [{ filename, mimeType, resource: "IMAGE", httpMethod: "POST", fileSize: String(bytes.length) }],
  });
  check(staged.stagedUploadsCreate.userErrors, "Upload");
  const target = staged.stagedUploadsCreate.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) throw new Error("Upload: Shopify gave no upload address");
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  const sent = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  if (!sent.ok) throw new Error(`Upload: the file couldn't be sent to Shopify (${sent.status})`);

  const r = await adminGraphql(session, ADD_PHOTO, {
    product: { id: productGid },
    media: [{ originalSource: target.resourceUrl, alt, mediaContentType: "IMAGE" }],
  });
  check(r.productUpdate.userErrors, "Add photo");
  const nodes = r.productUpdate.product?.media?.nodes ?? [];
  const added = nodes.filter((m) => !beforeIds.includes(m.id));
  const id = (added.find((m) => m.alt === alt) ?? added.at(-1))?.id;
  if (!id) throw new Error("Add photo: Shopify didn't return the new photo");
  return id;
}

/** Manual collections of the shop, to add a product to. */
export async function manualCollections(session) {
  const data = await adminGraphql(
    session,
    `#graphql
    query ManualCollections { collections(first: 250, query: "collection_type:custom", sortKey: TITLE) { nodes { id title } } }`,
  );
  return data.collections.nodes;
}
