// Collection Optimizer: the effect of a new order on the products it moved up to help them sell
// (hidden gems, slow movers, dead stock), measured by a rescue plan per product, like a fix. Each move
// is a fix of type "position", undone together with the order on the Collections page.

import { movedUp, movesToMeasure } from "@/lib/collection-order";
import { db } from "@/lib/db";
import { removeFromRescuePlan, startRescuePlan } from "@/lib/rescue-plans";

/** Bookkeeping must never change a save's or an undo's outcome once Shopify has been written. */
async function track(step) {
  try {
    return await step;
  } catch (error) {
    console.error("[collection-effects]", error);
    return null;
  }
}

/**
 * After a save: a "position" fix and a rescue plan for each product the order moved up by 3 places or
 * more into the first places, when it's a hidden gem, a slow mover or dead stock (bestsellers and
 * products that only slid up aren't measured; products the app doesn't know yet neither). Each product
 * on its own: one failing doesn't stop the others. Resolves the number measured.
 */
export async function startMoveEffects(shopId, save) {
  const moves = movedUp(save.before, save.after);
  if (!moves.length) return 0;
  const products = await db().product.findMany({ where: { shopId, shopifyGid: { in: moves.map((m) => m.id) } }, select: { id: true, shopifyGid: true } });
  const idOf = new Map(products.map((p) => [p.shopifyGid, p.id]));
  const scores = await db().productScore.findMany({
    where: { productId: { in: products.map((p) => p.id) } },
    orderBy: { computedAt: "desc" },
    distinct: ["productId"],
    select: { productId: true, status: true },
  });
  const statusOf = new Map(scores.map((s) => [s.productId, s.status]));
  const place = { collectionGid: save.collectionGid, collectionTitle: save.collectionTitle };
  let measured = 0;
  for (const m of movesToMeasure(moves, (gid) => statusOf.get(idOf.get(gid)))) {
    const productId = idOf.get(m.id);
    const fix = await track(
      db().fix.create({
        data: { productId, type: "position", before: { ...place, position: m.from + 1 }, after: { ...place, position: m.to + 1, reorderId: save.id }, status: "applied", appliedAt: new Date() },
      }),
    );
    if (!fix) continue;
    measured += 1;
    await track(startRescuePlan(shopId, productId, fix.id));
  }
  return measured;
}

/** After an undo: the save's moves are undone too, and leave their rescue plans (each on its own). */
export async function endMoveEffects(reorderId) {
  const fixes = await db().fix.findMany({ where: { type: "position", status: "applied", after: { path: ["reorderId"], equals: reorderId } }, select: { id: true, productId: true } });
  for (const f of fixes) {
    const done = await track(db().fix.update({ where: { id: f.id }, data: { status: "undone", undoneAt: new Date() } }));
    if (done) await track(removeFromRescuePlan(f.productId, f.id));
  }
}

export { track as trackEffect };
