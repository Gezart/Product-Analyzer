import { getOfflineSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { readLiveProduct, stateOf, writeState } from "@/lib/fix-shopify";
import { sameState } from "@/lib/fixes";
import { errorMessage, HttpError } from "@/lib/http-error";
import { enqueue } from "@/lib/jobs/queue";
import { removeFromRescuePlan, startRescuePlan } from "@/lib/rescue-plans";

export class FixError extends HttpError {}

/** A fix older than this still "approved" or "undoing" is a crashed attempt, not one in progress. */
const IN_PROGRESS_MS = 2 * 60_000;

async function productContext(shopId, productId) {
  const product = await db().product.findFirst({ where: { id: productId, shopId }, include: { shop: true } });
  if (!product) throw new FixError("Product not found", 404);
  return { product, session: await getOfflineSession(product.shop.domain) };
}

/** What Shopify holds now for this fix type (null if the read fails or the product is gone). */
async function readState(session, productGid, type) {
  const live = await readLiveProduct(session, productGid).catch(() => null);
  return live ? stateOf(live, type) : null;
}

/** Refresh local product data afterwards; a failure here must not change the fix's outcome. */
async function refreshProduct(shopId, productGid) {
  await enqueue({ type: "sync-product", shopId, payload: { productGid } }).catch(() => {});
}

/** Rescue-plan bookkeeping must not change a fix's outcome once Shopify has been written. */
async function track(step) {
  await step.catch((error) => console.error("[fix-center] rescue plan update failed", error));
}

/**
 * Applies a merchant-approved fix: reads the current state from Shopify (the snapshot for undo),
 * writes the new state, then stores what Shopify actually saved (it may normalize HTML) as `after`.
 *
 * `expected` is the state the merchant's page was showing; if Shopify changed since, nothing is
 * written (409), so a change made elsewhere isn't silently overwritten.
 *
 * If the write fails part way (e.g. one of several collection changes), the fix is kept as applied
 * when Shopify's state moved at all, so it can still be undone from the snapshot.
 */
export async function applyFix(
  shopId,
  productId,
  type,
  after,
  { diagnosisId, expected } = {},
) {
  const { product, session } = await productContext(shopId, productId);
  const live = await readLiveProduct(session, product.shopifyGid);
  if (!live) throw new FixError("Product no longer exists in Shopify", 404);
  const before = stateOf(live, type);
  if (expected !== undefined && !sameState(type, before, expected)) {
    throw new FixError("This product changed in Shopify since the page was opened. Reload and try again.", 409);
  }
  if (sameState(type, before, after)) throw new FixError("Nothing to change", 400);

  // One change per product at a time (double clicks, two tabs).
  const busy = await db().fix.findFirst({
    where: { productId, status: { in: ["approved", "undoing"] }, createdAt: { gt: new Date(Date.now() - IN_PROGRESS_MS) } },
  });
  if (busy) throw new FixError("Another change to this product is still being applied.", 409);

  const diagnosis = diagnosisId ? await db().diagnosis.findFirst({ where: { id: diagnosisId, productId } }) : null;
  const fix = await db().fix.create({
    data: { productId, diagnosisId: diagnosis?.id ?? null, type, before, after: after, status: "approved" },
  });

  let pending = false;
  let writeError = null;
  try {
    pending = (await writeState(session, product.shopifyGid, type, before, after)).pending;
  } catch (error) {
    writeError = error;
  }

  const saved = await readState(session, product.shopifyGid, type);
  if (writeError) {
    // Unchanged → failed. Changed, or unknown (read-back failed too) → kept undoable from the snapshot.
    const unchanged = saved != null && sameState(type, saved, before);
    const result = await db().fix.update({
      where: { id: fix.id },
      data: unchanged
        ? { status: "failed", error: errorMessage(writeError) }
        : {
            status: "applied",
            appliedAt: new Date(),
            after: (saved ?? after),
            error: `${saved ? "Partly applied" : "Outcome unknown"}: ${errorMessage(writeError)}`,
          },
    });
    await refreshProduct(shopId, product.shopifyGid);
    if (unchanged) throw new FixError(errorMessage(writeError), 502);
    await track(startRescuePlan(shopId, productId, fix.id));
    return result;
  }

  // Still being applied by Shopify (async job): record the intended state, not a stale read.
  const result = await db().fix.update({
    where: { id: fix.id },
    data: { status: "applied", appliedAt: new Date(), after: (pending || !saved ? after : saved) },
  });
  await refreshProduct(shopId, product.shopifyGid);
  // The fix's effect is measured from today.
  await track(startRescuePlan(shopId, productId, fix.id));
  return { ...result, pending };
}

/**
 * Undoes an applied (or crashed part-way) fix by writing its `before` snapshot back. If the product changed since (in
 * Shopify or by another fix), undo would overwrite that change, so it needs `force`.
 * The fix is claimed first ("undoing"), so two undos can't both run.
 */
export async function undoFix(shopId, fixId, { force = false } = {}) {
  const fix = await db().fix.findFirst({ where: { id: fixId, product: { shopId } }, include: { product: true } });
  if (!fix) throw new FixError("Fix not found", 404);
  // Applied fixes, and attempts that crashed part way (stuck "approved"/"undoing"), can be undone.
  const stale = new Date(Date.now() - IN_PROGRESS_MS);
  const undoable = fix.status === "applied" || (["approved", "undoing"].includes(fix.status) && fix.createdAt < stale);
  if (!undoable) throw new FixError(`This fix is ${fix.status}, not applied.`, 409);
  const otherInProgress = await db().fix.findFirst({
    where: { productId: fix.productId, id: { not: fix.id }, status: { in: ["approved", "undoing"] }, createdAt: { gt: stale } },
  });
  if (otherInProgress) throw new FixError("Another change to this product is still being applied.", 409);
  const { session } = await productContext(shopId, fix.productId);
  const type = fix.type;

  const live = await readLiveProduct(session, fix.product.shopifyGid);
  if (!live) throw new FixError("Product no longer exists in Shopify", 404);
  const current = stateOf(live, type);
  if (!force && !sameState(type, current, fix.after)) {
    throw new FixError("The product changed since this fix was applied. Undo anyway to overwrite that change.", 409);
  }

  const claimed = await db().fix.updateMany({ where: { id: fix.id, status: fix.status }, data: { status: "undoing", error: null } });
  if (claimed.count === 0) throw new FixError("This fix isn't applied (or is already being undone).", 409);

  try {
    const { pending } = await writeState(session, fix.product.shopifyGid, type, current, fix.before);
    await refreshProduct(shopId, fix.product.shopifyGid);
    const result = await db().fix.update({ where: { id: fix.id }, data: { status: "undone", undoneAt: new Date() } });
    await track(removeFromRescuePlan(fix.productId, fix.id));
    return { ...result, pending };
  } catch (error) {
    // Back to applied so it can be retried; the product may be partly restored.
    await db().fix.update({ where: { id: fix.id }, data: { status: "applied", error: `Undo failed: ${errorMessage(error)}` } });
    await refreshProduct(shopId, fix.product.shopifyGid);
    throw new FixError(`Undo failed: ${errorMessage(error)}`, 502);
  }
}
