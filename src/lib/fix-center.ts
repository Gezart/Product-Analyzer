import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readLiveProduct, stateOf, writeState } from "@/lib/fix-shopify";
import { sameState, type FixType } from "@/lib/fixes";
import { enqueue } from "@/lib/jobs/queue";

export class FixError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function productContext(shopId: string, productId: string) {
  const product = await db().product.findFirst({ where: { id: productId, shopId }, include: { shop: true } });
  if (!product) throw new FixError("Product not found", 404);
  return { product, session: await getOfflineSession(product.shop.domain) };
}

/**
 * Applies a merchant-approved fix: reads the current state from Shopify (the snapshot for undo),
 * writes the new state, then stores what Shopify actually saved (it may normalize HTML) as `after`.
 */
export async function applyFix(shopId: string, productId: string, type: FixType, after: unknown, diagnosisId?: string | null) {
  const { product, session } = await productContext(shopId, productId);
  const live = await readLiveProduct(session, product.shopifyGid);
  if (!live) throw new FixError("Product no longer exists in Shopify", 404);
  const before = stateOf(live, type);
  if (sameState(type, before, after)) throw new FixError("Nothing to change", 400);

  const diagnosis = diagnosisId ? await db().diagnosis.findFirst({ where: { id: diagnosisId, productId } }) : null;
  const fix = await db().fix.create({
    data: { productId, diagnosisId: diagnosis?.id ?? null, type, before, after: after as object, status: "approved" },
  });
  try {
    await writeState(session, product.shopifyGid, type, before, after);
    const saved = await readLiveProduct(session, product.shopifyGid);
    const result = await db().fix.update({
      where: { id: fix.id },
      data: { status: "applied", appliedAt: new Date(), after: saved ? stateOf(saved, type) : (after as object) },
    });
    await enqueue({ type: "sync-product", shopId, payload: { productGid: product.shopifyGid } });
    return result;
  } catch (error) {
    await db().fix.update({ where: { id: fix.id }, data: { status: "failed", error: (error as Error).message.slice(0, 500) } });
    throw new FixError((error as Error).message, 502);
  }
}

/**
 * Undoes an applied fix by writing its `before` snapshot back. If the product changed since (in
 * Shopify or by another fix), undo would overwrite that change, so it needs `force`.
 */
export async function undoFix(shopId: string, fixId: string, { force = false } = {}) {
  const fix = await db().fix.findFirst({ where: { id: fixId, product: { shopId } }, include: { product: true } });
  if (!fix) throw new FixError("Fix not found", 404);
  if (fix.status !== "applied") throw new FixError(`Fix is ${fix.status}, not applied`, 409);
  const { session } = await productContext(shopId, fix.productId);
  const type = fix.type as FixType;
  const live = await readLiveProduct(session, fix.product.shopifyGid);
  if (!live) throw new FixError("Product no longer exists in Shopify", 404);
  const current = stateOf(live, type);
  if (!force && !sameState(type, current, fix.after)) {
    throw new FixError("The product changed since this fix was applied. Undo anyway to overwrite that change.", 409);
  }
  await writeState(session, fix.product.shopifyGid, type, current, fix.before);
  await enqueue({ type: "sync-product", shopId, payload: { productGid: fix.product.shopifyGid } });
  return db().fix.update({ where: { id: fix.id }, data: { status: "undone", undoneAt: new Date() } });
}
