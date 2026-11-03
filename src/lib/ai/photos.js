// AI photos in the fix center: a draft made from one of the product's photos, which the merchant sees
// first and then adds to the product (an undoable fix) or discards. Also the merchant's own upload, for
// a product with no photo yet (the AI needs a real photo to start from).

import { AiError } from "@/lib/ai/errors";
import { editProductPhoto } from "@/lib/ai/openai-image";
import { aiAllowance, recordPhotoCost, releaseAi, reserveAi } from "@/lib/ai/usage";
import { aiPhotoAlt, DRAFT_TTL_MS, imageTypeOf, MAX_PHOTO_BYTES, photoPrompt, sourcePhotoUrl } from "@/lib/ai-photo";
import { db } from "@/lib/db";
import { addPhotoFix } from "@/lib/fix-center";
import { readLiveProduct } from "@/lib/fix-shopify";
import { HttpError } from "@/lib/http-error";

export const NO_PHOTO_MESSAGE = "This product has no photo yet. Add one first: the AI starts from a real photo of the product.";

/** A response body up to `max` bytes (read as it arrives, stopped beyond it), or null when larger. */
export async function readLimited(res, max) {
  if (Number(res.headers.get("content-length") ?? 0) > max) return null;
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
}

/** Reads a product photo from Shopify's CDN (only there), at most 20 MB, as jpeg, png or webp. */
async function readSourcePhoto(previewUrl) {
  const url = sourcePhotoUrl(previewUrl);
  if (!url) throw new HttpError("This photo can't be read.", 422);
  let res;
  try {
    res = await fetch(url, { redirect: "error", headers: { Accept: "image/jpeg,image/png,image/webp" }, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new HttpError("The photo couldn't be read from Shopify. Try again.", 502);
  }
  if (!res.ok) throw new HttpError("The photo couldn't be read from Shopify. Try again.", 502);
  const bytes = await readLimited(res, MAX_PHOTO_BYTES);
  if (!bytes) throw new HttpError("This photo is too large (over 20 MB).", 422);
  const mimeType = imageTypeOf(bytes);
  if (!mimeType) throw new HttpError("This photo's format can't be used (JPEG, PNG or WebP only).", 422);
  return { bytes, mimeType };
}

/** Drafts not added within a day are removed with their image (also nightly, job "ai-photo-drafts"). */
export async function pruneDrafts(shopId) {
  await db().aiPhotoDraft.deleteMany({ where: { shopId, status: { not: "added" }, createdAt: { lt: new Date(Date.now() - DRAFT_TTL_MS) } } });
}

const toDataUrl = (bytes, mimeType) => `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

/**
 * Makes a draft photo from one of the product's photos (`request` from `validatePhotoRequest`): one
 * of this month's AI photos is taken first and given back if no photo comes out. Resolves
 * `{ draft: { id, style, image }, ai }` (`image` a data URL for the preview).
 */
export async function createPhotoDraft(shop, session, product, request) {
  const live = await readLiveProduct(session, product.shopifyGid);
  if (!live) throw new HttpError("Product no longer exists in Shopify.", 404);
  const photos = live.media.filter((m) => m.type === "IMAGE" && m.previewUrl);
  if (!photos.length) throw new HttpError(NO_PHOTO_MESSAGE, 409);
  const source = photos.find((m) => m.id === request.mediaId);
  if (!source) throw new HttpError("Choose one of the product's photos.", 400);
  const input = await readSourcePhoto(source.previewUrl);
  const prompt = photoPrompt({ title: live.title, productType: product.productType, style: request.style, scene: request.scene });

  const month = await reserveAi(shop, "photos");
  let photo;
  try {
    photo = await editProductPhoto({ bytes: input.bytes, mimeType: input.mimeType, prompt });
    await recordPhotoCost(shop, month, photo.costUsd);
  } catch (error) {
    if (error?.costUsd) await recordPhotoCost(shop, month, error.costUsd);
    await releaseAi(shop, month, "photos");
    if (error instanceof AiError) throw new HttpError(error.message, error.status);
    throw error;
  }
  await pruneDrafts(shop.id);
  const draft = await db().aiPhotoDraft.create({
    data: { shopId: shop.id, productId: product.id, sourceMediaId: source.id, style: request.style, scene: request.scene, image: photo.bytes, mimeType: photo.mimeType },
    select: { id: true, style: true },
  });
  return { draft: { ...draft, image: toDataUrl(photo.bytes, photo.mimeType) }, ai: await aiAllowance(shop, "photos") };
}

async function findDraft(shopId, draftId) {
  const draft = await db().aiPhotoDraft.findFirst({ where: { id: String(draftId ?? ""), shopId }, include: { product: { select: { title: true } } } });
  if (!draft) throw new HttpError("This AI photo wasn't found (drafts are kept for a day).", 404);
  return draft;
}

const markAdded = (draftId, fix) =>
  db().aiPhotoDraft.update({ where: { id: draftId }, data: { status: "added", mediaId: fix.after?.added?.[0] ?? fix.mediaId ?? null, fixId: fix.id, image: null } });

/**
 * A draft left "adding" (the request that added it ended early): its fix says how it went. On the
 * product → the draft is marked added; failed or undone → it's a draft again. Otherwise it's still
 * being added (409).
 */
async function settleAdding(draft) {
  const fix = await db().fix.findFirst({ where: { productId: draft.productId, type: "photo", after: { path: ["draftId"], equals: draft.id } }, orderBy: { createdAt: "desc" } });
  if (fix?.status === "applied") {
    await markAdded(draft.id, fix);
    draft.status = "added";
  } else if (fix?.status === "failed" || fix?.status === "undone") {
    await db().aiPhotoDraft.updateMany({ where: { id: draft.id, status: "adding" }, data: { status: "draft" } });
    draft.status = "draft";
  } else {
    throw new HttpError("This photo is already being added.", 409);
  }
}

/**
 * Adds an approved draft to the product in Shopify, as an undoable fix. The draft is claimed first,
 * so a double click can't add it twice; if adding fails it goes back to a draft to try again.
 */
export async function addPhotoDraft(shop, draftId, { diagnosisId } = {}) {
  const draft = await findDraft(shop.id, draftId);
  if (draft.status === "adding") await settleAdding(draft);
  if (draft.status === "added") throw new HttpError("This photo is already on the product.", 409);
  if (draft.status !== "draft" || !draft.image || draft.createdAt < new Date(Date.now() - DRAFT_TTL_MS)) {
    throw new HttpError("This AI photo isn't available any more. Make a new one.", 410);
  }
  const claimed = await db().aiPhotoDraft.updateMany({ where: { id: draft.id, status: "draft" }, data: { status: "adding" } });
  if (claimed.count === 0) throw new HttpError("This photo is already being added.", 409);
  let fix;
  try {
    fix = await addPhotoFix(
      shop.id,
      draft.productId,
      { bytes: draft.image, mimeType: draft.mimeType, alt: aiPhotoAlt(draft.product.title, draft.style) },
      { ai: true, diagnosisId, draftId: draft.id },
    );
  } catch (error) {
    await db().aiPhotoDraft.update({ where: { id: draft.id }, data: { status: "draft" } });
    throw error;
  }
  // The image now lives in Shopify; only the link to it is kept.
  await markAdded(draft.id, fix);
  return fix;
}

/** The merchant doesn't want this photo: it's dropped (nothing was in Shopify). */
export async function discardPhotoDraft(shop, draftId) {
  const draft = await findDraft(shop.id, draftId);
  await db().aiPhotoDraft.updateMany({ where: { id: draft.id, status: "draft" }, data: { status: "discarded", image: null } });
  return { ok: true };
}

/** The merchant's own photo (a file from the browser) added to the product, as an undoable fix. */
export async function uploadOwnPhoto(shop, product, file) {
  if (!file || typeof file.arrayBuffer !== "function") throw new HttpError("Choose a photo to upload.", 400);
  if (file.size > MAX_PHOTO_BYTES) throw new HttpError("This photo is too large (over 20 MB).", 422);
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = imageTypeOf(bytes);
  if (!mimeType) throw new HttpError("Upload a JPEG, PNG or WebP photo.", 422);
  return addPhotoFix(shop.id, product.id, { bytes, mimeType, alt: String(product.title ?? "").slice(0, 500) });
}

/** The photos of a product that were made with AI and added (for the "AI" mark in the fix center). */
export async function aiMediaIds(productId) {
  const rows = await db().aiPhotoDraft.findMany({ where: { productId, status: "added", mediaId: { not: null } }, select: { mediaId: true } });
  return rows.map((r) => r.mediaId);
}
