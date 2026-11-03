// Collection Optimizer: the effect of a new order on the products it moved up into the first places,
// measured by a rescue plan per product (like a fix). Each move is a fix of type "position", undone
// together with the order on the Collections page.

import { movedUp } from "@/lib/collection-order";
import { db } from "@/lib/db";
import { removeFromRescuePlan, startRescuePlan } from "@/lib/rescue-plans";

/** Bookkeeping must never change a save's or an undo's outcome once Shopify has been written. */
async function track(step) {
  await step.catch((error) => console.error("[collection-effects]", error));
}

/**
 * After a save: a "position" fix and a rescue plan for each product the order moved up into the first
 * places (products the app doesn't know yet are left out). Resolves the number measured.
 */
export async function startMoveEffects(shopId, save) {
  const moves = movedUp(save.before, save.after);
  if (!moves.length) return 0;
  const products = await db().product.findMany({ where: { shopId, shopifyGid: { in: moves.map((m) => m.id) } }, select: { id: true, shopifyGid: true } });
  const idOf = new Map(products.map((p) => [p.shopifyGid, p.id]));
  let measured = 0;
  for (const m of moves) {
    const productId = idOf.get(m.id);
    if (!productId) continue;
    const place = { collectionGid: save.collectionGid, collectionTitle: save.collectionTitle };
    const fix = await db().fix.create({
      data: {
        productId,
        type: "position",
        before: { ...place, position: m.from + 1 },
        after: { ...place, position: m.to + 1, reorderId: save.id },
        status: "applied",
        appliedAt: new Date(),
      },
    });
    await track(startRescuePlan(shopId, productId, fix.id));
    measured += 1;
  }
  return measured;
}

/** After an undo: the save's moves are undone too, and leave their rescue plans. */
export async function endMoveEffects(reorderId) {
  const fixes = await db().fix.findMany({ where: { type: "position", status: "applied", after: { path: ["reorderId"], equals: reorderId } }, select: { id: true, productId: true } });
  for (const f of fixes) {
    await db().fix.update({ where: { id: f.id }, data: { status: "undone", undoneAt: new Date() } });
    await track(removeFromRescuePlan(f.productId, f.id));
  }
}

export { track as trackEffect };
